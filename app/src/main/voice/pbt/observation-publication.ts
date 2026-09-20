import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  randomUUID
} from 'crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import { createIncidentFingerprint, hashTaggedValue } from './observation-canonical'
import {
  annotationSchema,
  rawObservationSchema,
  type ObservationAnnotation,
  type RawObservation
} from './observation-schema'

const DEFAULT_MAX_FILES = 5_000
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const EVIDENCE_PATH = /^(?:raw|annotations)\/[^/\\]+$/

const diagnosticSchema = z
  .object({
    diagnosticId: z.string().regex(SHA256),
    layer: z.enum(['raw', 'annotations', 'store']),
    reasonCategory: z.enum([
      'malformed',
      'partial',
      'broken-link',
      'restricted',
      'empty-spool',
      'invalid-provenance',
      'invalid-integrity',
      'invalid-campaign'
    ]),
    issueCodes: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
    byteCount: z.number().int().nonnegative()
  })
  .strict()

const encryptionSchema = z
  .object({
    keyAlgorithm: z.literal('RSA-OAEP-SHA256'),
    contentAlgorithm: z.literal('AES-256-GCM'),
    keyId: z.string().regex(SHA256),
    wrappedKey: z.string().regex(BASE64),
    iv: z.string().regex(BASE64),
    authTag: z.string().regex(BASE64)
  })
  .strict()

const payloadReferenceSchema = z
  .object({
    path: z.literal('payload.enc'),
    sha256: z.string().regex(SHA256),
    bytes: z.number().int().positive()
  })
  .strict()

const publicManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    cycleId: z.string(),
    createdAt: z.string().datetime(),
    runId: z.string(),
    runAttempt: z.string(),
    encryption: encryptionSchema,
    payload: payloadReferenceSchema,
    diagnostics: z.array(diagnosticSchema)
  })
  .strict()

const trustedManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    cycleId: z.string(),
    createdAt: z.string().datetime(),
    runId: z.string(),
    runAttempt: z.string(),
    repositorySha: z.string().nullable(),
    repositoryBranch: z.string().nullable(),
    workflow: z.string().nullable(),
    job: z.string().nullable(),
    encryption: encryptionSchema,
    payload: payloadReferenceSchema,
    rawEventIds: z.array(z.string().uuid()),
    annotationIds: z.array(z.string().uuid()),
    stuckCampaignIds: z.array(z.string().uuid()),
    diagnostics: z.array(diagnosticSchema)
  })
  .strict()

const payloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.array(
      z
        .object({
          path: z.string().regex(EVIDENCE_PATH),
          bytes: z.string().regex(BASE64)
        })
        .strict()
    )
  })
  .strict()

export type PublicObservationCycleManifest = z.infer<typeof publicManifestSchema>
export type TrustedObservationCycleManifest = z.infer<typeof trustedManifestSchema>

interface CycleIdentity {
  runId: string
  runAttempt: string
}

export interface EncryptObservationCycleOptions extends CycleIdentity {
  sourceRoot: string
  destinationRoot: string
  publicKey: string | Buffer
  now?: () => Date
  maxFiles?: number
  maxBytes?: number
}

export interface DecryptObservationCycleOptions extends CycleIdentity {
  sourceRoot: string
  destinationRoot: string
  privateKeys: Record<string, string | Buffer>
  repositorySha: string | null
  repositoryBranch: string | null
  workflow: string | null
  job: string | null
  maxFiles?: number
  maxBytes?: number
}

export interface DecryptStoredObservationCycleOptions {
  sourceRoot: string
  privateKeys: Record<string, string | Buffer>
  maxFiles?: number
  maxBytes?: number
}

export interface DecryptedObservationCycle {
  manifest: PublicObservationCycleManifest | TrustedObservationCycleManifest
  entries: Array<{ path: string; bytes: Buffer }>
}

interface ByteSnapshot {
  path: string
  bytes: Buffer
}

type PublicDiagnostic = z.infer<typeof diagnosticSchema>

interface ParsedEvidence {
  rawEvents: RawObservation[]
  annotations: ObservationAnnotation[]
  diagnostics: PublicDiagnostic[]
  rawByteCounts: Map<string, number>
}

interface EncryptedPayload {
  ciphertext: Buffer
  encryption: z.infer<typeof encryptionSchema>
}

interface CycleResult<T> {
  cyclePath: string
  manifest: T
}

function hashBytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function keyId(key: string | Buffer): string {
  return hashBytes(createPublicKey(key).export({ type: 'spki', format: 'der' }))
}

function resolvePrivateKey(
  encryption: z.infer<typeof encryptionSchema>,
  privateKeys: Record<string, string | Buffer>
): string | Buffer {
  const privateKey = privateKeys[encryption.keyId]
  if (!privateKey) throw new Error(`PBT private key ${encryption.keyId} is unavailable`)
  if (keyId(privateKey) !== encryption.keyId)
    throw new Error('PBT encryption key identity mismatch')
  return privateKey
}

function assertSafeSegment(label: string, value: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`Invalid PBT ${label}`)
}

function readBounded(path: string, remainingBytes: number): Buffer {
  const handle = openSync(path, 'r')
  try {
    const size = fstatSync(handle).size
    if (size > remainingBytes) throw new Error('PBT publication byte limit exceeded')
    const bytes = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const count = readSync(handle, bytes, offset, size - offset, null)
      if (count === 0) break
      offset += count
    }
    if (readSync(handle, Buffer.alloc(1), 0, 1, null) !== 0)
      throw new Error('PBT source changed during snapshot')
    return bytes.subarray(0, offset)
  } finally {
    closeSync(handle)
  }
}

function snapshotSpool(root: string, maxFiles: number, maxBytes: number): ByteSnapshot[] {
  if (!existsSync(root)) return []
  const snapshots: ByteSnapshot[] = []
  let usedBytes = 0
  for (const layer of ['raw', 'annotations'] as const) {
    const directory = join(root, layer)
    if (!existsSync(directory)) continue
    if (!lstatSync(directory).isDirectory())
      throw new Error(`PBT ${layer} layer is not a directory`)
    for (const name of readdirSync(directory).sort()) {
      if (snapshots.length >= maxFiles) throw new Error('PBT publication file limit exceeded')
      const absolutePath = join(directory, name)
      if (!lstatSync(absolutePath).isFile())
        throw new Error(`PBT publication rejects non-file ${layer} entry`)
      const bytes = readBounded(absolutePath, maxBytes - usedBytes)
      usedBytes += bytes.byteLength
      snapshots.push({ path: `${layer}/${name}`, bytes })
    }
  }
  return snapshots
}

function snapshotEncryptedCycle(
  root: string,
  maxBytes: number
): {
  manifestBytes: Buffer
  payloadBytes: Buffer
} {
  const names = readdirSync(root).sort()
  if (JSON.stringify(names) !== JSON.stringify(['manifest.json', 'payload.enc']))
    throw new Error('PBT encrypted cycle file set mismatch')
  const manifestBytes = readBounded(join(root, 'manifest.json'), maxBytes)
  const payloadBytes = readBounded(join(root, 'payload.enc'), maxBytes - manifestBytes.byteLength)
  return { manifestBytes, payloadBytes }
}

function encryptedByteLimit(maxBytes: number): number {
  return maxBytes * 2 + 1024 * 1024
}

function makeDiagnostic(
  cycleId: string,
  ordinal: number,
  layer: PublicDiagnostic['layer'],
  reasonCategory: PublicDiagnostic['reasonCategory'],
  issueCodes: string[],
  byteCount: number
): PublicDiagnostic {
  const identity = JSON.stringify({
    cycleId,
    ordinal,
    layer,
    reasonCategory,
    issueCodes,
    byteCount
  })
  return diagnosticSchema.parse({
    diagnosticId: hashBytes(identity),
    layer,
    reasonCategory,
    issueCodes,
    byteCount
  })
}

function appendDiagnostic(
  diagnostics: PublicDiagnostic[],
  cycleId: string,
  layer: PublicDiagnostic['layer'],
  reasonCategory: PublicDiagnostic['reasonCategory'],
  issueCodes: string[],
  byteCount: number
): void {
  diagnostics.push(
    makeDiagnostic(cycleId, diagnostics.length, layer, reasonCategory, issueCodes, byteCount)
  )
}

function parseEvidence(entries: ByteSnapshot[], cycleId: string): ParsedEvidence {
  const rawEvents: RawObservation[] = []
  const annotations: ObservationAnnotation[] = []
  const rawByteCounts = new Map<string, number>()
  const diagnostics: PublicDiagnostic[] = []
  const addDiagnostic = (
    layer: PublicDiagnostic['layer'],
    reasonCategory: PublicDiagnostic['reasonCategory'],
    issueCodes: string[],
    byteCount: number
  ): void => {
    appendDiagnostic(diagnostics, cycleId, layer, reasonCategory, issueCodes, byteCount)
  }

  for (const entry of entries) {
    const [layer, name] = entry.path.split('/') as ['raw' | 'annotations', string]
    if (!name.endsWith('.json')) {
      addDiagnostic(layer, 'partial', ['incomplete-atomic-write'], entry.bytes.byteLength)
      continue
    }
    let value: unknown
    try {
      value = JSON.parse(entry.bytes.toString('utf8'))
    } catch {
      addDiagnostic(layer, 'malformed', ['invalid-json'], entry.bytes.byteLength)
      continue
    }
    if (layer === 'raw') {
      const parsed = rawObservationSchema.safeParse(value)
      if (!parsed.success) {
        addDiagnostic(layer, 'malformed', ['schema-invalid'], entry.bytes.byteLength)
        continue
      }
      if (name !== `${parsed.data.eventId}.json`) {
        addDiagnostic(layer, 'malformed', ['identity-mismatch'], entry.bytes.byteLength)
        continue
      }
      if (parsed.data.publicationClass !== 'synthetic') {
        addDiagnostic(
          layer,
          'restricted',
          [`publication-${parsed.data.publicationClass}`],
          entry.bytes.byteLength
        )
        continue
      }
      rawEvents.push(parsed.data)
      rawByteCounts.set(parsed.data.eventId, entry.bytes.byteLength)
      continue
    }
    const parsed = annotationSchema.safeParse(value)
    if (!parsed.success) {
      addDiagnostic(layer, 'malformed', ['schema-invalid'], entry.bytes.byteLength)
      continue
    }
    if (name !== `${parsed.data.annotationId}.json`) {
      addDiagnostic(layer, 'malformed', ['identity-mismatch'], entry.bytes.byteLength)
      continue
    }
    if (parsed.data.publicationClass !== 'synthetic') {
      addDiagnostic(
        layer,
        'restricted',
        [`publication-${parsed.data.publicationClass}`],
        entry.bytes.byteLength
      )
      continue
    }
    annotations.push(parsed.data)
  }

  if (entries.length === 0) addDiagnostic('store', 'empty-spool', ['no-evidence'], 0)
  return { rawEvents, annotations, diagnostics, rawByteCounts }
}

function encodePayload(entries: ByteSnapshot[]): Buffer {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      entries: entries.map((entry) => ({ path: entry.path, bytes: entry.bytes.toString('base64') }))
    })
  )
}

function decodePayload(bytes: Buffer, maxFiles: number, maxBytes: number): ByteSnapshot[] {
  const payload = payloadSchema.parse(JSON.parse(bytes.toString('utf8')))
  if (payload.entries.length > maxFiles) throw new Error('PBT publication file limit exceeded')
  const paths = new Set<string>()
  let usedBytes = 0
  return payload.entries.map((entry) => {
    if (paths.has(entry.path)) throw new Error('PBT encrypted payload contains duplicate paths')
    paths.add(entry.path)
    const decoded = Buffer.from(entry.bytes, 'base64')
    if (decoded.toString('base64') !== entry.bytes)
      throw new Error('PBT encrypted payload contains invalid base64')
    usedBytes += decoded.byteLength
    if (usedBytes > maxBytes) throw new Error('PBT publication byte limit exceeded')
    return { path: entry.path, bytes: decoded }
  })
}

function encryptPayload(payload: Buffer, publicKey: string | Buffer): EncryptedPayload {
  const contentKey = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', contentKey, iv)
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()])
  const wrappedKey = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    contentKey
  )
  return {
    ciphertext,
    encryption: {
      keyAlgorithm: 'RSA-OAEP-SHA256' as const,
      contentAlgorithm: 'AES-256-GCM' as const,
      keyId: keyId(publicKey),
      wrappedKey: wrappedKey.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64')
    }
  }
}

function decryptPayload(
  ciphertext: Buffer,
  encryption: z.infer<typeof encryptionSchema>,
  privateKey: string | Buffer
): Buffer {
  try {
    const contentKey = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(encryption.wrappedKey, 'base64')
    )
    const decipher = createDecipheriv(
      'aes-256-gcm',
      contentKey,
      Buffer.from(encryption.iv, 'base64')
    )
    decipher.setAuthTag(Buffer.from(encryption.authTag, 'base64'))
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new Error('PBT ciphertext authentication failed')
  }
}

function provenanceIssue(
  event: RawObservation,
  options: DecryptObservationCycleOptions
): string | null {
  const expected = {
    sha: options.repositorySha,
    branch: options.repositoryBranch,
    runId: options.runId,
    runAttempt: options.runAttempt,
    workflow: options.workflow,
    job: options.job
  }
  const actual = {
    sha: event.repository.sha,
    branch: event.repository.branch,
    runId: event.ci.runId,
    runAttempt: event.ci.runAttempt,
    workflow: event.ci.workflow,
    job: event.ci.job
  }
  return JSON.stringify(actual) === JSON.stringify(expected) &&
    event.ci.provider === 'github-actions'
    ? null
    : 'authoritative-run-mismatch'
}

function semanticHashIssue(event: RawObservation): string | null {
  if (event.eventKind !== 'failure-observed') return null
  if (event.counterexampleCaptureStatus !== 'captured') return null
  const counterexampleHash =
    event.counterexample === null ? null : hashTaggedValue(event.counterexample)
  if (counterexampleHash !== event.counterexampleHash) return 'counterexample-hash-mismatch'
  const fingerprint = createIncidentFingerprint(event.property, counterexampleHash)
  return fingerprint === event.incidentFingerprint ? null : 'incident-fingerprint-mismatch'
}

function validateCampaign(campaignId: string, campaign: RawObservation[]): boolean {
  const starts = campaign.filter((event) => event.eventKind === 'campaign-started')
  const failures = campaign.filter((event) => event.eventKind === 'failure-observed')
  const completions = campaign.filter((event) => event.eventKind === 'campaign-completed')
  if (starts.length !== 1) throw new Error(`PBT campaign ${campaignId} has invalid start count`)
  const reference = starts[0]
  const identity = JSON.stringify({
    property: reference.property,
    harnessVersion: reference.harnessVersion,
    observationClass: reference.observationClass,
    publicationClass: reference.publicationClass,
    seed: reference.seed,
    requestedRuns: reference.requestedRuns
  })
  const provenance = JSON.stringify({
    repository: reference.repository,
    ci: reference.ci,
    agent: reference.agent ?? null,
    environment: reference.environment
  })
  if (
    campaign.some(
      (event) =>
        JSON.stringify({
          property: event.property,
          harnessVersion: event.harnessVersion,
          observationClass: event.observationClass,
          publicationClass: event.publicationClass,
          seed: event.seed,
          requestedRuns: event.requestedRuns
        }) !== identity
    )
  )
    throw new Error(`PBT campaign ${campaignId} identity metadata changed`)
  if (
    campaign.some(
      (event) =>
        JSON.stringify({
          repository: event.repository,
          ci: event.ci,
          agent: event.agent ?? null,
          environment: event.environment
        }) !== provenance
    )
  )
    throw new Error(`PBT campaign ${campaignId} provenance metadata changed`)
  if (completions.length === 0) return true
  if (completions.length !== 1)
    throw new Error(`PBT campaign ${campaignId} has invalid completion count`)
  const completion = completions[0]
  if (completion.terminationStatus === 'passed' && failures.length > 0)
    throw new Error(`PBT campaign ${campaignId} passed with failure observations`)
  if (completion.terminationStatus === 'failed' && failures.length === 0)
    throw new Error(`PBT campaign ${campaignId} failed without a failure observation`)
  if (completion.summary !== null && completion.summary.failureCount !== failures.length)
    throw new Error(`PBT campaign ${campaignId} failure denominator mismatch`)
  if (completion.terminationStatus !== 'unknown') {
    for (const failure of failures) {
      if (
        failure.executedRuns !== completion.executedRuns ||
        failure.generatedCases !== completion.generatedCases ||
        failure.skippedCases !== completion.skippedCases ||
        failure.shrinkCount !== completion.shrinkCount ||
        failure.replayPath !== completion.replayPath ||
        failure.failureText !== completion.failureText ||
        failure.failureTextCaptureStatus !== completion.failureTextCaptureStatus ||
        failure.failureTextCaptureError !== completion.failureTextCaptureError
      )
        throw new Error(`PBT campaign ${campaignId} failure facts mismatch`)
    }
  }
  return false
}

function validateEvidence(
  parsed: ParsedEvidence,
  cycleId: string,
  options: DecryptObservationCycleOptions
): {
  rawEvents: RawObservation[]
  annotations: ObservationAnnotation[]
  stuckCampaignIds: string[]
  diagnostics: PublicDiagnostic[]
} {
  const diagnostics = [...parsed.diagnostics]
  const candidates: RawObservation[] = []
  const addDiagnostic = (
    layer: PublicDiagnostic['layer'],
    reasonCategory: PublicDiagnostic['reasonCategory'],
    issueCodes: string[],
    byteCount: number
  ): void => {
    appendDiagnostic(diagnostics, cycleId, layer, reasonCategory, issueCodes, byteCount)
  }
  for (const event of parsed.rawEvents) {
    const provenance = provenanceIssue(event, options)
    if (provenance !== null) {
      addDiagnostic(
        'raw',
        'invalid-provenance',
        [provenance],
        parsed.rawByteCounts.get(event.eventId) ?? 0
      )
      continue
    }
    const integrity = semanticHashIssue(event)
    if (integrity !== null) {
      addDiagnostic(
        'raw',
        'invalid-integrity',
        [integrity],
        parsed.rawByteCounts.get(event.eventId) ?? 0
      )
      continue
    }
    candidates.push(event)
  }
  const campaigns = new Map<string, RawObservation[]>()
  for (const event of candidates) {
    const campaign = campaigns.get(event.campaignId) ?? []
    campaign.push(event)
    campaigns.set(event.campaignId, campaign)
  }
  const rawEvents: RawObservation[] = []
  const stuckCampaignIds: string[] = []
  for (const [campaignId, campaign] of campaigns) {
    try {
      if (validateCampaign(campaignId, campaign)) stuckCampaignIds.push(campaignId)
      rawEvents.push(...campaign)
    } catch {
      addDiagnostic(
        'raw',
        'invalid-campaign',
        ['campaign-inconsistent'],
        campaign.reduce((total, event) => total + (parsed.rawByteCounts.get(event.eventId) ?? 0), 0)
      )
    }
  }
  return {
    rawEvents,
    annotations: parsed.annotations,
    stuckCampaignIds: stuckCampaignIds.sort(),
    diagnostics
  }
}

function writeAtomic(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  const handle = openSync(temporaryPath, 'wx', 0o600)
  try {
    writeFileSync(handle, bytes)
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
  renameSync(temporaryPath, path)
}

function renameDirectoryAtomic(source: string, destination: string): void {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      renameSync(source, destination)
      return
    } catch (error) {
      lastError = error
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 10)
    }
  }
  throw lastError
}

function writeCycle(
  destinationRoot: string,
  cycleId: string,
  payload: Buffer,
  manifest: PublicObservationCycleManifest | TrustedObservationCycleManifest
): string {
  const cyclePath = join(destinationRoot, cycleId)
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  if (existsSync(cyclePath)) {
    if (
      !readFileSync(join(cyclePath, 'payload.enc')).equals(payload) ||
      !readFileSync(join(cyclePath, 'manifest.json')).equals(manifestBytes)
    )
      throw new Error(`PBT cycle ${cycleId} already exists with different evidence`)
    return cyclePath
  }
  mkdirSync(destinationRoot, { recursive: true })
  const temporaryCycle = join(destinationRoot, `.${cycleId}.${process.pid}.${randomUUID()}.tmp`)
  mkdirSync(temporaryCycle)
  try {
    writeAtomic(join(temporaryCycle, 'payload.enc'), payload)
    writeAtomic(join(temporaryCycle, 'manifest.json'), manifestBytes)
    renameDirectoryAtomic(temporaryCycle, cyclePath)
  } catch (error) {
    rmSync(temporaryCycle, { recursive: true, force: true })
    if (
      existsSync(cyclePath) &&
      readFileSync(join(cyclePath, 'payload.enc')).equals(payload) &&
      readFileSync(join(cyclePath, 'manifest.json')).equals(manifestBytes)
    )
      return cyclePath
    throw error
  }
  return cyclePath
}

export function encryptObservationCycle(
  options: EncryptObservationCycleOptions
): CycleResult<PublicObservationCycleManifest> {
  assertSafeSegment('run id', options.runId)
  assertSafeSegment('run attempt', options.runAttempt)
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const cycleId = `${options.runId}-${options.runAttempt}`
  const existingCycle = join(options.destinationRoot, cycleId)
  if (existsSync(existingCycle)) {
    const snapshot = snapshotEncryptedCycle(existingCycle, encryptedByteLimit(maxBytes))
    const manifest = publicManifestSchema.parse(JSON.parse(snapshot.manifestBytes.toString('utf8')))
    if (
      manifest.cycleId !== cycleId ||
      manifest.runId !== options.runId ||
      manifest.runAttempt !== options.runAttempt ||
      manifest.payload.bytes !== snapshot.payloadBytes.byteLength ||
      manifest.payload.sha256 !== hashBytes(snapshot.payloadBytes)
    )
      throw new Error(`PBT cycle ${cycleId} already exists with different evidence`)
    return { cyclePath: existingCycle, manifest }
  }
  const entries = snapshotSpool(options.sourceRoot, maxFiles, maxBytes)
  const diagnostics = parseEvidence(entries, cycleId).diagnostics
  const encrypted = encryptPayload(encodePayload(entries), options.publicKey)
  const manifest = publicManifestSchema.parse({
    schemaVersion: 1,
    cycleId,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    runId: options.runId,
    runAttempt: options.runAttempt,
    encryption: encrypted.encryption,
    payload: {
      path: 'payload.enc',
      sha256: hashBytes(encrypted.ciphertext),
      bytes: encrypted.ciphertext.byteLength
    },
    diagnostics
  })
  const cyclePath = writeCycle(options.destinationRoot, cycleId, encrypted.ciphertext, manifest)
  return { cyclePath, manifest }
}

export function decryptAndValidateObservationCycle(
  options: DecryptObservationCycleOptions
): CycleResult<TrustedObservationCycleManifest> {
  assertSafeSegment('run id', options.runId)
  assertSafeSegment('run attempt', options.runAttempt)
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const cycleId = `${options.runId}-${options.runAttempt}`
  const snapshot = snapshotEncryptedCycle(options.sourceRoot, encryptedByteLimit(maxBytes))
  const publicManifest = publicManifestSchema.parse(
    JSON.parse(snapshot.manifestBytes.toString('utf8'))
  )
  if (
    publicManifest.cycleId !== cycleId ||
    publicManifest.runId !== options.runId ||
    publicManifest.runAttempt !== options.runAttempt
  )
    throw new Error('PBT encrypted cycle identity mismatch')
  if (
    publicManifest.payload.bytes !== snapshot.payloadBytes.byteLength ||
    publicManifest.payload.sha256 !== hashBytes(snapshot.payloadBytes)
  )
    throw new Error('PBT encrypted payload content mismatch')
  const privateKey = resolvePrivateKey(publicManifest.encryption, options.privateKeys)
  const plaintext = decryptPayload(snapshot.payloadBytes, publicManifest.encryption, privateKey)
  const entries = decodePayload(plaintext, maxFiles, maxBytes)
  const parsed = parseEvidence(entries, cycleId)
  if (JSON.stringify(parsed.diagnostics) !== JSON.stringify(publicManifest.diagnostics))
    throw new Error('PBT public diagnostics mismatch decrypted evidence')
  const validated = validateEvidence(parsed, cycleId, options)
  const manifest = trustedManifestSchema.parse({
    schemaVersion: 1,
    cycleId,
    createdAt: publicManifest.createdAt,
    runId: options.runId,
    runAttempt: options.runAttempt,
    repositorySha: options.repositorySha,
    repositoryBranch: options.repositoryBranch,
    workflow: options.workflow,
    job: options.job,
    encryption: publicManifest.encryption,
    payload: publicManifest.payload,
    rawEventIds: validated.rawEvents.map((event) => event.eventId).sort(),
    annotationIds: validated.annotations.map((annotation) => annotation.annotationId).sort(),
    stuckCampaignIds: validated.stuckCampaignIds,
    diagnostics: validated.diagnostics
  })
  const cyclePath = writeCycle(options.destinationRoot, cycleId, snapshot.payloadBytes, manifest)
  return { cyclePath, manifest }
}

export function decryptObservationCycle(
  options: DecryptStoredObservationCycleOptions
): DecryptedObservationCycle {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const snapshot = snapshotEncryptedCycle(options.sourceRoot, encryptedByteLimit(maxBytes))
  const value: unknown = JSON.parse(snapshot.manifestBytes.toString('utf8'))
  const trusted = trustedManifestSchema.safeParse(value)
  const publicCycle = publicManifestSchema.safeParse(value)
  let manifest: PublicObservationCycleManifest | TrustedObservationCycleManifest
  if (trusted.success) manifest = trusted.data
  else if (publicCycle.success) manifest = publicCycle.data
  else throw new Error('PBT encrypted cycle manifest is invalid')
  if (
    manifest.payload.bytes !== snapshot.payloadBytes.byteLength ||
    manifest.payload.sha256 !== hashBytes(snapshot.payloadBytes)
  )
    throw new Error('PBT encrypted payload content mismatch')
  const privateKey = resolvePrivateKey(manifest.encryption, options.privateKeys)
  const entries = decodePayload(
    decryptPayload(snapshot.payloadBytes, manifest.encryption, privateKey),
    maxFiles,
    maxBytes
  )
  if (trusted.success) {
    const trustedManifest = trusted.data
    const parsed = parseEvidence(entries, manifest.cycleId)
    const validated = validateEvidence(parsed, manifest.cycleId, {
      sourceRoot: options.sourceRoot,
      destinationRoot: options.sourceRoot,
      privateKeys: options.privateKeys,
      runId: trustedManifest.runId,
      runAttempt: trustedManifest.runAttempt,
      repositorySha: trustedManifest.repositorySha,
      repositoryBranch: trustedManifest.repositoryBranch,
      workflow: trustedManifest.workflow,
      job: trustedManifest.job,
      maxFiles,
      maxBytes
    })
    const expected = {
      rawEventIds: validated.rawEvents.map((event) => event.eventId).sort(),
      annotationIds: validated.annotations.map((annotation) => annotation.annotationId).sort(),
      stuckCampaignIds: validated.stuckCampaignIds,
      diagnostics: validated.diagnostics
    }
    const actual = {
      rawEventIds: trustedManifest.rawEventIds,
      annotationIds: trustedManifest.annotationIds,
      stuckCampaignIds: trustedManifest.stuckCampaignIds,
      diagnostics: trustedManifest.diagnostics
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error('PBT trusted manifest does not match decrypted evidence')
  }
  return { manifest, entries }
}
