import {
  constants,
  createDecipheriv,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  randomUUID
} from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashCanonicalValue, stringifyCanonical, toTaggedValue } from './observation-canonical'
import type { RawObservation } from './observation-schema'
import { appendAnnotation, appendRawObservation } from './observation-store'
import {
  decryptAndValidateObservationCycle,
  decryptObservationCycle,
  encryptObservationCycle
} from './observation-publication'

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function removeTestRoot(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  } catch {
    return
  }
}

function makeEvent(overrides: Partial<RawObservation> = {}): RawObservation {
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    campaignId: '9482051d-ef39-4464-bcf5-8c3bb7c67d0e',
    eventKind: 'campaign-started',
    observedAt: '2026-09-19T12:00:00.000Z',
    repository: { sha: 'a'.repeat(40), branch: 'main', worktree: null },
    ci: {
      provider: 'github-actions',
      runId: '101',
      runAttempt: '2',
      workflow: 'CI',
      job: 'build-and-test'
    },
    property: { id: 'example/property', version: '1', invariant: 'output stays ordered' },
    harnessVersion: '1',
    observationClass: 'organic',
    publicationClass: 'synthetic',
    seed: 42,
    replayPath: null,
    requestedRuns: 200,
    executedRuns: null,
    generatedCases: null,
    skippedCases: null,
    shrinkCount: null,
    counterexample: null,
    counterexampleHash: null,
    counterexampleCaptureStatus: null,
    counterexampleCaptureError: null,
    incidentFingerprint: null,
    failureText: null,
    failureTextCaptureStatus: null,
    failureTextCaptureError: null,
    environment: { platform: 'win32', arch: 'x64', nodeVersion: 'v22.0.0', ci: true },
    terminationStatus: 'started',
    summary: null,
    ...overrides
  }
}

function decryptTestPayload(
  payload: Buffer,
  manifest: { encryption: ReturnType<typeof encryptObservationCycle>['manifest']['encryption'] },
  privateKey: string
): Array<{ path: string; bytes: string }> {
  const contentKey = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    },
    Buffer.from(manifest.encryption.wrappedKey, 'base64')
  )
  const decipher = createDecipheriv(
    'aes-256-gcm',
    contentKey,
    Buffer.from(manifest.encryption.iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(manifest.encryption.authTag, 'base64'))
  const plaintext = Buffer.concat([decipher.update(payload), decipher.final()])
  return JSON.parse(plaintext.toString('utf8')).entries
}

describe('PBT observation publication', () => {
  let sourceRoot: string
  let encryptedRoot: string
  let trustedRoot: string
  let publicKey: string
  let privateKey: string

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    publicKey = pair.publicKey
    privateKey = pair.privateKey
  })

  beforeEach(() => {
    sourceRoot = mkdtempSync(join(tmpdir(), 'starfolio-pbt-source-'))
    encryptedRoot = mkdtempSync(join(tmpdir(), 'starfolio-pbt-encrypted-'))
    trustedRoot = mkdtempSync(join(tmpdir(), 'starfolio-pbt-trusted-'))
  })

  afterEach(() => {
    removeTestRoot(sourceRoot)
    removeTestRoot(encryptedRoot)
    removeTestRoot(trustedRoot)
  })

  function encrypt() {
    return encryptObservationCycle({
      sourceRoot,
      destinationRoot: encryptedRoot,
      publicKey,
      runId: '101',
      runAttempt: '2',
      now: () => new Date('2026-09-19T12:02:00.000Z')
    })
  }

  function validate(sourceRootOverride?: string) {
    return decryptAndValidateObservationCycle({
      sourceRoot: sourceRootOverride ?? join(encryptedRoot, '101-2'),
      destinationRoot: trustedRoot,
      privateKeys: {
        [sha256(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))]: privateKey
      },
      runId: '101',
      runAttempt: '2',
      repositorySha: 'a'.repeat(40),
      repositoryBranch: 'main',
      workflow: 'CI',
      job: 'build-and-test'
    })
  }

  it('publishes one encrypted payload without plaintext evidence', () => {
    const interviewText = 'PRIVATE INTERVIEW: customer migration failed'
    appendRawObservation(
      sourceRoot,
      makeEvent({
        eventKind: 'failure-observed',
        executedRuns: 1,
        generatedCases: 1,
        skippedCases: 0,
        shrinkCount: 0,
        counterexampleCaptureStatus: 'absent',
        counterexampleCaptureError: null,
        incidentFingerprint: null,
        failureText: interviewText,
        failureTextCaptureStatus: 'captured',
        failureTextCaptureError: null,
        terminationStatus: 'failed'
      })
    )

    const result = encrypt()
    const files = readdirSync(result.cyclePath).sort()
    const artifactBytes = files.map((name) => readFileSync(join(result.cyclePath, name))).join('')

    expect(files).toEqual(['manifest.json', 'payload.enc'])
    expect(artifactBytes).not.toContain(interviewText)
    expect(result.manifest).not.toHaveProperty('rawEventIds')
    expect(result.manifest.payload.path).toBe('payload.enc')
  })

  it('decrypts and fully validates raw observations', () => {
    const start = makeEvent()
    const complete = makeEvent({
      eventKind: 'campaign-completed',
      executedRuns: 200,
      generatedCases: 200,
      skippedCases: 0,
      terminationStatus: 'passed',
      summary: {
        requestedRuns: 200,
        executedRuns: 200,
        generatedCases: 200,
        skippedCases: 0,
        failureCount: 0
      }
    })
    appendRawObservation(sourceRoot, start)
    appendRawObservation(sourceRoot, complete)
    const encrypted = encrypt()

    const trusted = validate()

    expect(trusted.manifest.rawEventIds).toEqual([start.eventId, complete.eventId].sort())
    expect(trusted.manifest.stuckCampaignIds).toEqual([])
    expect(readFileSync(join(trusted.cyclePath, 'payload.enc'))).toEqual(
      readFileSync(join(encrypted.cyclePath, 'payload.enc'))
    )
    expect(trusted.manifest.encryption).toEqual(encrypted.manifest.encryption)
    expect(trusted.manifest.encryption.keyId).toMatch(/^[a-f0-9]{64}$/)
    expect(
      decryptObservationCycle({
        sourceRoot: trusted.cyclePath,
        privateKeys: {
          [trusted.manifest.encryption.keyId]: privateKey,
          ['f'.repeat(64)]: generateKeyPairSync('rsa', {
            modulusLength: 2048,
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' }
          }).privateKey
        }
      }).entries
    ).toHaveLength(2)
    expect(() =>
      decryptObservationCycle({
        sourceRoot: trusted.cyclePath,
        privateKeys: { ['f'.repeat(64)]: privateKey }
      })
    ).toThrow(/key/i)
  })

  it('validates a version 2 campaign under local agent authority', () => {
    const agent = {
      runId: 'agent-run-1',
      stepId: 'step-1',
      worktreeState: 'dirty' as const,
      worktreeStateHash: 'b'.repeat(64)
    }
    const repository = {
      sha: 'c'.repeat(40),
      branch: 'feat/pbt-agent-checkpoints',
      worktree: 'C:/worktree'
    }
    const ci = {
      provider: null,
      runId: null,
      runAttempt: null,
      workflow: null,
      job: null
    }
    const start = makeEvent({ schemaVersion: 2, agent, repository, ci })
    const complete = makeEvent({
      schemaVersion: 2,
      agent,
      repository,
      ci,
      eventKind: 'campaign-completed',
      executedRuns: 200,
      generatedCases: 200,
      skippedCases: 0,
      terminationStatus: 'passed',
      summary: {
        requestedRuns: 200,
        executedRuns: 200,
        generatedCases: 200,
        skippedCases: 0,
        failureCount: 0
      }
    })
    appendRawObservation(sourceRoot, start)
    appendRawObservation(sourceRoot, complete)
    const encrypted = encrypt()
    const trusted = decryptAndValidateObservationCycle({
      sourceRoot: encrypted.cyclePath,
      destinationRoot: trustedRoot,
      privateKeys: {
        [sha256(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))]: privateKey
      },
      runId: '101',
      runAttempt: '2',
      repositorySha: repository.sha,
      repositoryBranch: repository.branch,
      workflow: null,
      job: null,
      authority: {
        kind: 'local-agent',
        runId: agent.runId,
        stepId: agent.stepId,
        worktreeStateHash: agent.worktreeStateHash,
        completedWorktreeStateHash: agent.worktreeStateHash,
        worktreeChanged: false
      }
    })

    expect(trusted.manifest).toMatchObject({
      schemaVersion: 2,
      authority: {
        kind: 'local-agent',
        runId: agent.runId,
        stepId: agent.stepId,
        worktreeStateHash: agent.worktreeStateHash,
        completedWorktreeStateHash: agent.worktreeStateHash,
        worktreeChanged: false
      },
      rawEventIds: [start.eventId, complete.eventId].sort()
    })
    expect(
      decryptObservationCycle({
        sourceRoot: trusted.cyclePath,
        privateKeys: {
          [trusted.manifest.encryption.keyId]: privateKey
        }
      }).manifest
    ).toEqual(trusted.manifest)
  })

  it.each([
    { completedWorktreeStateHash: null, worktreeChanged: false },
    { completedWorktreeStateHash: 'd'.repeat(64), worktreeChanged: false },
    { completedWorktreeStateHash: 'b'.repeat(64), worktreeChanged: true }
  ])(
    'rejects contradictory local agent authority %#',
    ({ completedWorktreeStateHash, worktreeChanged }) => {
      appendRawObservation(sourceRoot, makeEvent())
      const encrypted = encrypt()

      expect(() =>
        decryptAndValidateObservationCycle({
          sourceRoot: encrypted.cyclePath,
          destinationRoot: trustedRoot,
          privateKeys: {
            [sha256(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))]:
              privateKey
          },
          runId: '101',
          runAttempt: '2',
          repositorySha: 'a'.repeat(40),
          repositoryBranch: 'main',
          workflow: null,
          job: null,
          authority: {
            kind: 'local-agent',
            runId: 'agent-run-1',
            stepId: 'step-1',
            worktreeStateHash: 'b'.repeat(64),
            completedWorktreeStateHash,
            worktreeChanged
          }
        })
      ).toThrow(/authority/i)
    }
  )

  it('quarantines both evidence layers when worktree identity changes', () => {
    const agent = {
      runId: 'agent-run-1',
      stepId: 'step-1',
      worktreeState: 'dirty' as const,
      worktreeStateHash: 'b'.repeat(64)
    }
    const repository = {
      sha: 'c'.repeat(40),
      branch: 'feat/pbt-agent-checkpoints',
      worktree: 'C:/worktree'
    }
    const event = makeEvent({
      schemaVersion: 2,
      agent,
      repository,
      ci: { provider: null, runId: null, runAttempt: null, workflow: null, job: null }
    })
    appendRawObservation(sourceRoot, event)
    const annotationId = randomUUID()
    appendAnnotation(sourceRoot, {
      schemaVersion: 1,
      annotationId,
      targetEventId: event.eventId,
      recordedAt: '2026-09-19T12:01:00.000Z',
      author: { kind: 'agent', id: agent.runId },
      publicationClass: 'synthetic',
      annotationKind: 'disposition',
      disposition: 'unresolved',
      duplicateOfEventId: null,
      evidence: null,
      note: null
    })
    const encrypted = encrypt()
    const trusted = decryptAndValidateObservationCycle({
      sourceRoot: encrypted.cyclePath,
      destinationRoot: trustedRoot,
      privateKeys: {
        [sha256(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))]: privateKey
      },
      runId: '101',
      runAttempt: '2',
      repositorySha: repository.sha,
      repositoryBranch: repository.branch,
      workflow: null,
      job: null,
      authority: {
        kind: 'local-agent',
        runId: agent.runId,
        stepId: agent.stepId,
        worktreeStateHash: agent.worktreeStateHash,
        completedWorktreeStateHash: 'd'.repeat(64),
        worktreeChanged: true
      }
    })

    expect(trusted.manifest.rawEventIds).toEqual([])
    expect(trusted.manifest.annotationIds).toEqual([])
    expect(trusted.manifest.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: 'annotations',
          reasonCategory: 'invalid-provenance',
          issueCodes: ['worktree-changed-during-command']
        })
      ])
    )
  })

  it('rejects ciphertext tampering', () => {
    appendRawObservation(sourceRoot, makeEvent())
    const encrypted = encrypt()
    const payloadPath = join(encrypted.cyclePath, 'payload.enc')
    const bytes = readFileSync(payloadPath)
    bytes[0] ^= 0xff
    writeFileSync(payloadPath, bytes)

    expect(() => validate()).toThrow(/ciphertext|payload/i)
  })

  it('keeps exact malformed bytes only inside encrypted payload', () => {
    mkdirSync(join(sourceRoot, 'raw'))
    const malformed = Buffer.from('{"candidate":"real interview text"')
    writeFileSync(join(sourceRoot, 'raw', 'candidate-name.json'), malformed)

    const encrypted = encrypt()
    const publicManifest = JSON.stringify(encrypted.manifest)

    expect(publicManifest).not.toContain('candidate-name')
    expect(publicManifest).not.toContain(sha256(malformed.toString()))
    expect(publicManifest).not.toContain('real interview text')
    expect(encrypted.manifest.diagnostics[0]).toMatchObject({
      layer: 'raw',
      reasonCategory: 'malformed',
      byteCount: malformed.byteLength
    })
    expect(encrypted.manifest.diagnostics[0].issueCodes).toEqual(['invalid-json'])
    const decryptedEntries = decryptTestPayload(
      readFileSync(join(encrypted.cyclePath, 'payload.enc')),
      encrypted.manifest,
      privateKey
    )
    expect(Buffer.from(decryptedEntries[0].bytes, 'base64')).toEqual(malformed)

    const trusted = validate()
    expect(trusted.manifest.diagnostics[0]).toMatchObject({
      layer: 'raw',
      reasonCategory: 'malformed',
      byteCount: malformed.byteLength
    })
  })

  it('quarantines a forged counterexample hash without dropping valid peers', () => {
    const counterexample = toTaggedValue([{ value: 7 }])
    const validCampaignId = randomUUID()
    const validStart = makeEvent({ campaignId: validCampaignId })
    const validComplete = makeEvent({
      campaignId: validCampaignId,
      eventKind: 'campaign-completed',
      executedRuns: 200,
      generatedCases: 200,
      skippedCases: 0,
      terminationStatus: 'passed',
      summary: {
        requestedRuns: 200,
        executedRuns: 200,
        generatedCases: 200,
        skippedCases: 0,
        failureCount: 0
      }
    })
    const forged = makeEvent({
      eventKind: 'failure-observed',
      executedRuns: 1,
      generatedCases: 1,
      skippedCases: 0,
      shrinkCount: 0,
      counterexample,
      counterexampleHash: 'b'.repeat(64),
      counterexampleCaptureStatus: 'captured',
      counterexampleCaptureError: null,
      incidentFingerprint: hashCanonicalValue({
        propertyId: 'example/property',
        propertyVersion: '1',
        invariant: 'output stays ordered',
        counterexampleHash: 'b'.repeat(64)
      }),
      failureText: 'failed',
      failureTextCaptureStatus: 'captured',
      failureTextCaptureError: null,
      terminationStatus: 'failed'
    })
    appendRawObservation(sourceRoot, validStart)
    appendRawObservation(sourceRoot, validComplete)
    appendRawObservation(sourceRoot, forged)
    encrypt()

    const trusted = validate()

    expect(trusted.manifest.rawEventIds).toEqual([validStart.eventId, validComplete.eventId].sort())
    expect(trusted.manifest.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: 'raw',
          reasonCategory: 'invalid-integrity',
          issueCodes: ['counterexample-hash-mismatch']
        })
      ])
    )
    expect(
      decryptTestPayload(
        readFileSync(join(trusted.cyclePath, 'payload.enc')),
        trusted.manifest,
        privateKey
      ).some((entry) => entry.path === `raw/${forged.eventId}.json`)
    ).toBe(true)
    expect(sha256(stringifyCanonical(counterexample))).not.toBe('b'.repeat(64))
  })

  it('quarantines a forged incident fingerprint after decryption', () => {
    const counterexample = toTaggedValue([1])
    const counterexampleHash = hashCanonicalValue([1])
    const event = makeEvent({
      eventKind: 'failure-observed',
      executedRuns: 1,
      generatedCases: 1,
      skippedCases: 0,
      shrinkCount: 0,
      counterexample,
      counterexampleHash,
      counterexampleCaptureStatus: 'captured',
      counterexampleCaptureError: null,
      incidentFingerprint: 'c'.repeat(64),
      failureText: 'failed',
      failureTextCaptureStatus: 'captured',
      failureTextCaptureError: null,
      terminationStatus: 'failed'
    })
    appendRawObservation(sourceRoot, event)
    encrypt()

    const trusted = validate()

    expect(trusted.manifest.rawEventIds).toEqual([])
    expect(trusted.manifest.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCategory: 'invalid-integrity',
          issueCodes: ['incident-fingerprint-mismatch']
        })
      ])
    )
  })

  it('quarantines provenance that differs from the authoritative workflow run', () => {
    const event = makeEvent({ repository: { sha: 'b'.repeat(40), branch: 'main', worktree: null } })
    appendRawObservation(sourceRoot, event)
    const annotation = {
      schemaVersion: 1 as const,
      annotationId: randomUUID(),
      targetEventId: event.eventId,
      recordedAt: '2026-09-19T12:03:00.000Z',
      author: { kind: 'agent' as const, id: 'observer' },
      publicationClass: 'synthetic' as const,
      note: null,
      annotationKind: 'classification' as const,
      classification: 'unresolved',
      evidence: null
    }
    const annotations = join(sourceRoot, 'annotations')
    mkdirSync(annotations)
    writeFileSync(
      join(annotations, `${annotation.annotationId}.json`),
      `${JSON.stringify(annotation)}\n`
    )
    encrypt()

    const trusted = validate()

    expect(trusted.manifest.rawEventIds).toEqual([])
    expect(trusted.manifest.annotationIds).toEqual([annotation.annotationId])
    expect(trusted.manifest.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: 'raw',
          reasonCategory: 'invalid-provenance',
          issueCodes: ['authoritative-run-mismatch']
        })
      ])
    )
    expect(trusted.manifest.diagnostics.some((item) => item.layer === 'annotations')).toBe(false)
  })

  it('quarantines campaign identity changes after decryption', () => {
    appendRawObservation(sourceRoot, makeEvent())
    appendRawObservation(
      sourceRoot,
      makeEvent({
        eventKind: 'campaign-completed',
        seed: 99,
        executedRuns: 200,
        generatedCases: 200,
        skippedCases: 0,
        terminationStatus: 'passed',
        summary: {
          requestedRuns: 200,
          executedRuns: 200,
          generatedCases: 200,
          skippedCases: 0,
          failureCount: 0
        }
      })
    )
    encrypt()

    const trusted = validate()

    expect(trusted.manifest.rawEventIds).toEqual([])
    expect(trusted.manifest.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: 'raw',
          reasonCategory: 'invalid-campaign',
          issueCodes: ['campaign-inconsistent']
        })
      ])
    )
  })

  it('quarantines failure and completion fact drift', () => {
    const start = makeEvent()
    const failure = makeEvent({
      eventKind: 'failure-observed',
      eventId: randomUUID(),
      replayPath: '0:1',
      executedRuns: 1,
      generatedCases: 1,
      skippedCases: 0,
      shrinkCount: 0,
      counterexampleCaptureStatus: 'absent',
      failureText: 'failed',
      failureTextCaptureStatus: 'captured',
      terminationStatus: 'failed'
    })
    const completion = makeEvent({
      eventKind: 'campaign-completed',
      eventId: randomUUID(),
      replayPath: '0:2',
      executedRuns: 1,
      generatedCases: 1,
      skippedCases: 0,
      shrinkCount: 0,
      failureText: 'failed',
      failureTextCaptureStatus: 'captured',
      terminationStatus: 'failed',
      summary: {
        requestedRuns: 200,
        executedRuns: 1,
        generatedCases: 1,
        skippedCases: 0,
        failureCount: 1
      }
    })
    appendRawObservation(sourceRoot, start)
    appendRawObservation(sourceRoot, failure)
    appendRawObservation(sourceRoot, completion)
    encrypt()

    const trusted = validate()

    expect(trusted.manifest.rawEventIds).toEqual([])
    expect(trusted.manifest.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: 'raw',
          reasonCategory: 'invalid-campaign',
          issueCodes: ['campaign-inconsistent']
        })
      ])
    )
  })

  it('retains unknown campaign completion with explicit null denominators', () => {
    const start = makeEvent()
    const complete = makeEvent({
      eventKind: 'campaign-completed',
      terminationStatus: 'unknown'
    })
    appendRawObservation(sourceRoot, start)
    appendRawObservation(sourceRoot, complete)
    encrypt()

    const trusted = validate()

    expect(trusted.manifest.rawEventIds).toEqual([start.eventId, complete.eventId].sort())
    expect(trusted.manifest.stuckCampaignIds).toEqual([])
  })

  it('retains annotation links to events from earlier cycles', () => {
    appendRawObservation(sourceRoot, makeEvent())
    const annotation = {
      schemaVersion: 1,
      annotationId: randomUUID(),
      targetEventId: randomUUID(),
      recordedAt: '2026-09-19T12:03:00.000Z',
      author: { kind: 'agent', id: 'observer' },
      publicationClass: 'synthetic',
      note: null,
      annotationKind: 'classification',
      classification: 'unresolved',
      evidence: null
    }
    mkdirSync(join(sourceRoot, 'annotations'))
    writeFileSync(
      join(sourceRoot, 'annotations', `${annotation.annotationId}.json`),
      `${JSON.stringify(annotation, null, 2)}\n`
    )

    const encrypted = encrypt()

    expect(encrypted.manifest.diagnostics.some((item) => item.layer === 'annotations')).toBe(false)
    expect(validate().manifest.annotationIds).toEqual([annotation.annotationId])
  })

  it('enforces byte limits before parsing or encryption', () => {
    mkdirSync(join(sourceRoot, 'raw'))
    writeFileSync(join(sourceRoot, 'raw', 'large.json'), Buffer.alloc(65, 0x61))

    expect(() =>
      encryptObservationCycle({
        sourceRoot,
        destinationRoot: encryptedRoot,
        publicKey,
        runId: '101',
        runAttempt: '2',
        maxBytes: 64
      })
    ).toThrow(/byte limit/i)
  })

  it('returns identical artifacts for idempotent trusted retries', () => {
    appendRawObservation(sourceRoot, makeEvent())
    encrypt()
    const first = validate()
    const second = validate()

    expect(second.manifest).toEqual(first.manifest)
  })

  it('returns the existing encrypted artifact for an idempotent retry', () => {
    appendRawObservation(sourceRoot, makeEvent())
    const first = encrypt()
    const second = encrypt()

    expect(second.manifest).toEqual(first.manifest)
    expect(readFileSync(join(second.cyclePath, 'payload.enc'))).toEqual(
      readFileSync(join(first.cyclePath, 'payload.enc'))
    )
  })
})
