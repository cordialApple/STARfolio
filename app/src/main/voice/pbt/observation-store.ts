import { randomUUID } from 'crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, relative, resolve } from 'path'
import { execFileSync } from 'child_process'
import { createIncidentFingerprint, hashTaggedValue } from './observation-canonical'
import {
  annotationSchema,
  agentProvenanceSchema,
  rawObservationSchema,
  type AgentProvenance,
  type ObservationAnnotation,
  type RawObservation
} from './observation-schema'

type DiagnosticKind = 'malformed' | 'partial' | 'broken-link' | 'inconsistent-campaign'

export interface ObservationDiagnostic {
  kind: DiagnosticKind
  path: string
  message: string
  content: string | null
}

export interface ObservationStoreSnapshot {
  rawEvents: RawObservation[]
  annotations: ObservationAnnotation[]
  diagnostics: ObservationDiagnostic[]
}

export interface ObservationLinkOptions {
  knownEventIds?: Iterable<string>
}

interface ProvenanceOptions {
  env?: Record<string, string | undefined>
  cwd?: string
  readGit?: (args: string[]) => string | null
  platform?: NodeJS.Platform
  arch?: string
  nodeVersion?: string
}

const EVENT_KIND_ORDER: Record<RawObservation['eventKind'], number> = {
  'campaign-started': 0,
  'failure-observed': 1,
  'campaign-completed': 2
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function readGitValue(cwd: string, args: string[]): string | null {
  try {
    const value = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return value || null
  } catch {
    return null
  }
}

function toNullable(value: string | undefined): string | null {
  return value?.trim() || null
}

function parseCiState(value: string | undefined): boolean | null {
  if (value === undefined) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return null
}

export function collectAgentProvenance(
  env: Record<string, string | undefined> = process.env
): AgentProvenance {
  const worktreeState = env.PBT_WORKTREE_STATE
  return agentProvenanceSchema.parse({
    runId: toNullable(env.PBT_AGENT_RUN_ID),
    stepId: toNullable(env.PBT_AGENT_STEP_ID),
    worktreeState:
      worktreeState === 'clean' || worktreeState === 'dirty' ? worktreeState : 'unknown',
    worktreeStateHash: toNullable(env.PBT_WORKTREE_STATE_HASH)
  })
}

export function collectObservationProvenance(
  options: ProvenanceOptions = {}
): Pick<RawObservation, 'repository' | 'ci' | 'environment'> {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const readGit = options.readGit ?? ((args: string[]) => readGitValue(cwd, args))
  const isGitHub = env.GITHUB_ACTIONS === 'true'
  const ci = parseCiState(env.CI)

  return {
    repository: {
      sha:
        toNullable(env.PBT_REPOSITORY_SHA) ??
        toNullable(env.GITHUB_SHA) ??
        readGit(['rev-parse', 'HEAD']),
      branch:
        toNullable(env.PBT_REPOSITORY_BRANCH) ??
        toNullable(env.GITHUB_HEAD_REF) ??
        toNullable(env.GITHUB_REF_NAME) ??
        readGit(['branch', '--show-current']),
      worktree: toNullable(env.GITHUB_WORKSPACE) ?? readGit(['rev-parse', '--show-toplevel'])
    },
    ci: {
      provider: isGitHub ? 'github-actions' : null,
      runId: isGitHub ? toNullable(env.GITHUB_RUN_ID) : null,
      runAttempt: isGitHub ? toNullable(env.GITHUB_RUN_ATTEMPT) : null,
      workflow: isGitHub ? toNullable(env.GITHUB_WORKFLOW) : null,
      job: isGitHub ? toNullable(env.GITHUB_JOB) : null
    },
    environment: {
      platform: options.platform ?? process.platform,
      arch: options.arch ?? process.arch,
      nodeVersion: options.nodeVersion ?? process.version,
      ci
    }
  }
}

export function resolveObservationRoot(
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
  readGit: (args: string[]) => string | null = (args) => readGitValue(cwd, args)
): string {
  if (env.PBT_SPOOL_DIR) return resolve(cwd, env.PBT_SPOOL_DIR)
  const gitCommonDir = readGit(['rev-parse', '--git-common-dir'])
  if (gitCommonDir) {
    const commonRoot = isAbsolute(gitCommonDir) ? gitCommonDir : resolve(cwd, gitCommonDir)
    return join(commonRoot, 'pbt-observations')
  }
  return join(homedir(), '.starfolio', 'pbt-observations')
}

function appendValidatedJson(
  root: string,
  layer: 'raw' | 'annotations',
  id: string,
  value: RawObservation | ObservationAnnotation
): string {
  const directory = join(root, layer)
  mkdirSync(directory, { recursive: true })
  const destination = join(directory, `${id}.json`)
  const lockPath = `${destination}.lock`
  const tempPath = join(directory, `.${id}.${process.pid}.${randomUUID()}.tmp`)
  if (existsSync(destination)) throw new Error(`PBT observation ${id} already exists`)
  const lock = openSync(lockPath, 'wx', 0o600)
  let temp: number | null = null
  let didCommit = false
  let rejectedExisting = false

  try {
    if (existsSync(destination)) {
      rejectedExisting = true
      throw new Error(`PBT observation ${id} already exists`)
    }
    temp = openSync(tempPath, 'wx', 0o600)
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fsyncSync(temp)
    closeSync(temp)
    temp = null
    renameSync(tempPath, destination)
    didCommit = true
    return destination
  } finally {
    if (temp !== null) closeSync(temp)
    closeSync(lock)
    if (didCommit || rejectedExisting) unlinkSync(lockPath)
  }
}

export function appendRawObservation(root: string, event: RawObservation): string {
  const parsed = rawObservationSchema.parse(event)
  return appendValidatedJson(root, 'raw', parsed.eventId, parsed)
}

export function appendAnnotation(
  root: string,
  annotation: ObservationAnnotation,
  options: ObservationLinkOptions = {}
): string {
  const parsed = annotationSchema.parse(annotation)
  const eventIds = new Set(options.knownEventIds)
  for (const event of readObservationStore(root, options).rawEvents) eventIds.add(event.eventId)
  if (!eventIds.has(parsed.targetEventId))
    throw new Error(`PBT annotation target ${parsed.targetEventId} does not exist`)
  const duplicateOfEventId = 'duplicateOfEventId' in parsed ? parsed.duplicateOfEventId : null
  if (duplicateOfEventId !== null && !eventIds.has(duplicateOfEventId))
    throw new Error(`PBT duplicate target ${duplicateOfEventId} does not exist`)
  return appendValidatedJson(root, 'annotations', parsed.annotationId, parsed)
}

function diagnoseCampaigns(events: RawObservation[]): ObservationDiagnostic[] {
  const campaigns = new Map<string, RawObservation[]>()
  for (const event of events) {
    const campaign = campaigns.get(event.campaignId) ?? []
    campaign.push(event)
    campaigns.set(event.campaignId, campaign)
  }
  const diagnostics: ObservationDiagnostic[] = []
  const add = (campaignId: string, message: string): void => {
    diagnostics.push({
      kind: 'inconsistent-campaign',
      path: `campaigns/${campaignId}`,
      message,
      content: null
    })
  }

  const eventIdCounts = new Map<string, number>()
  for (const event of events) {
    eventIdCounts.set(event.eventId, (eventIdCounts.get(event.eventId) ?? 0) + 1)
  }
  for (const [eventId, count] of eventIdCounts) {
    if (count > 1) add('unknown', `duplicate event id ${eventId}`)
  }

  for (const [campaignId, campaign] of campaigns) {
    const starts = campaign.filter((event) => event.eventKind === 'campaign-started')
    const failures = campaign.filter((event) => event.eventKind === 'failure-observed')
    const completions = campaign.filter((event) => event.eventKind === 'campaign-completed')
    if (starts.length === 0) add(campaignId, 'missing campaign start')
    if (starts.length > 1) add(campaignId, 'multiple campaign starts')
    if (completions.length === 0) add(campaignId, 'missing campaign completion')
    if (completions.length > 1) add(campaignId, 'multiple campaign completions')

    const reference = starts[0] ?? campaign[0]
    const propertyKey = JSON.stringify(reference.property)
    if (campaign.some((event) => JSON.stringify(event.property) !== propertyKey)) {
      add(campaignId, 'property metadata changed')
    }
    if (
      campaign.some(
        (event) =>
          event.harnessVersion !== reference.harnessVersion ||
          event.observationClass !== reference.observationClass ||
          event.publicationClass !== reference.publicationClass ||
          event.seed !== reference.seed ||
          event.requestedRuns !== reference.requestedRuns
      )
    ) {
      add(campaignId, 'identity metadata changed')
    }
    const provenanceKey = JSON.stringify({
      repository: reference.repository,
      ci: reference.ci,
      agent: reference.agent ?? null,
      environment: reference.environment
    })
    if (
      campaign.some(
        (event) =>
          JSON.stringify({
            repository: event.repository,
            ci: event.ci,
            agent: event.agent ?? null,
            environment: event.environment
          }) !== provenanceKey
      )
    ) {
      add(campaignId, 'provenance metadata changed')
    }

    for (const completion of completions) {
      if (completion.terminationStatus === 'passed' && failures.length > 0) {
        add(campaignId, 'passed campaign has failures')
      }
      if (completion.summary && completion.summary.failureCount !== failures.length) {
        add(campaignId, 'failure count does not match observed failures')
      }
      if (completion.terminationStatus === 'failed' && failures.length === 0) {
        add(campaignId, 'failed campaign has no failure observation')
      }
      if (
        failures.some(
          (failure) =>
            failure.requestedRuns !== completion.requestedRuns ||
            failure.executedRuns !== completion.executedRuns ||
            failure.generatedCases !== completion.generatedCases ||
            failure.skippedCases !== completion.skippedCases ||
            failure.shrinkCount !== completion.shrinkCount ||
            failure.replayPath !== completion.replayPath ||
            failure.failureText !== completion.failureText ||
            failure.failureTextCaptureStatus !== completion.failureTextCaptureStatus ||
            failure.failureTextCaptureError !== completion.failureTextCaptureError
        )
      ) {
        add(campaignId, 'failure and completion facts differ')
      }
    }
  }
  return diagnostics
}

function readLayer<T>(
  root: string,
  layer: 'raw' | 'annotations',
  parse: (value: unknown) => T
): { values: T[]; diagnostics: ObservationDiagnostic[] } {
  const directory = join(root, layer)
  if (!existsSync(directory)) return { values: [], diagnostics: [] }
  const values: T[] = []
  const diagnostics: ObservationDiagnostic[] = []

  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name)
    const relativePath = relative(root, path).replaceAll('\\', '/')
    let content: string | null = null
    try {
      content = readFileSync(path, 'utf8')
    } catch (error) {
      diagnostics.push({
        kind: 'partial',
        path: relativePath,
        message: String(error),
        content: null
      })
      continue
    }
    if (!name.endsWith('.json')) {
      diagnostics.push({
        kind: 'partial',
        path: relativePath,
        message: 'Incomplete atomic write',
        content
      })
      continue
    }
    try {
      values.push(parse(JSON.parse(content)))
    } catch (error) {
      diagnostics.push({ kind: 'malformed', path: relativePath, message: String(error), content })
    }
  }
  return { values, diagnostics }
}

export function readObservationStore(
  root: string,
  options: ObservationLinkOptions = {}
): ObservationStoreSnapshot {
  const raw = readLayer(root, 'raw', (value) => {
    const event = rawObservationSchema.parse(value)
    if (event.eventKind !== 'failure-observed') return event
    if (event.counterexampleCaptureStatus !== 'captured') return event
    const counterexampleHash =
      event.counterexample === null ? null : hashTaggedValue(event.counterexample)
    if (counterexampleHash !== event.counterexampleHash)
      throw new Error('PBT counterexample hash mismatch')
    if (createIncidentFingerprint(event.property, counterexampleHash) !== event.incidentFingerprint)
      throw new Error('PBT incident fingerprint mismatch')
    return event
  })
  const annotations = readLayer(root, 'annotations', (value) => annotationSchema.parse(value))
  const eventIds = new Set(options.knownEventIds)
  for (const event of raw.values) eventIds.add(event.eventId)
  const annotationIdCounts = new Map<string, number>()
  for (const annotation of annotations.values) {
    annotationIdCounts.set(
      annotation.annotationId,
      (annotationIdCounts.get(annotation.annotationId) ?? 0) + 1
    )
  }
  const duplicateAnnotationDiagnostics = [...annotationIdCounts]
    .filter(([, count]) => count > 1)
    .map(([annotationId]) => ({
      kind: 'malformed' as const,
      path: `annotations/${annotationId}.json`,
      message: `Duplicate annotation id ${annotationId}`,
      content: null
    }))
  const linkDiagnostics = annotations.values.flatMap((annotation) => {
    const duplicateOfEventId =
      'duplicateOfEventId' in annotation ? annotation.duplicateOfEventId : null
    const missing = [annotation.targetEventId, duplicateOfEventId].filter(
      (id): id is string => id !== null && !eventIds.has(id)
    )
    return missing.map((id) => ({
      kind: 'broken-link' as const,
      path: `annotations/${annotation.annotationId}.json`,
      message: `Annotation links missing event ${id}`,
      content: null
    }))
  })

  return {
    rawEvents: raw.values.sort(
      (left, right) =>
        compareText(left.observedAt, right.observedAt) ||
        compareText(left.campaignId, right.campaignId) ||
        EVENT_KIND_ORDER[left.eventKind] - EVENT_KIND_ORDER[right.eventKind] ||
        compareText(left.eventId, right.eventId)
    ),
    annotations: annotations.values.sort(
      (left, right) =>
        compareText(left.recordedAt, right.recordedAt) ||
        compareText(left.annotationId, right.annotationId)
    ),
    diagnostics: [
      ...raw.diagnostics,
      ...annotations.diagnostics,
      ...duplicateAnnotationDiagnostics,
      ...linkDiagnostics,
      ...diagnoseCampaigns(raw.values)
    ].sort((left, right) => compareText(left.path, right.path))
  }
}
