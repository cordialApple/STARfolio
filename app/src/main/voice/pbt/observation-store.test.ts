import { randomUUID } from 'crypto'
import { buildSync } from 'esbuild'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIncidentFingerprint, hashTaggedValue } from './observation-canonical'
import type { ObservationAnnotation, RawObservation } from './observation-schema'
import {
  appendAnnotation,
  appendRawObservation,
  collectAgentProvenance,
  collectObservationProvenance,
  readObservationStore
} from './observation-store'

function makeEvent(overrides: Partial<RawObservation> = {}): RawObservation {
  const property = { id: 'example/property', version: '1', invariant: 'output stays ordered' }
  const counterexample = [1]
  const counterexampleHash = hashTaggedValue(counterexample)
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    campaignId: '9482051d-ef39-4464-bcf5-8c3bb7c67d0e',
    eventKind: 'failure-observed',
    observedAt: '2026-09-19T12:00:00.000Z',
    repository: { sha: null, branch: null, worktree: null },
    ci: { provider: null, runId: null, runAttempt: null, workflow: null, job: null },
    property,
    harnessVersion: '1',
    observationClass: 'organic',
    publicationClass: 'synthetic',
    seed: 42,
    replayPath: '0:1',
    requestedRuns: 200,
    executedRuns: 7,
    generatedCases: 10,
    skippedCases: 3,
    shrinkCount: 2,
    counterexample,
    counterexampleHash,
    counterexampleCaptureStatus: 'captured',
    counterexampleCaptureError: null,
    incidentFingerprint: createIncidentFingerprint(property, counterexampleHash),
    failureText: 'expected true to be false',
    failureTextCaptureStatus: 'captured',
    failureTextCaptureError: null,
    environment: { platform: 'win32', arch: 'x64', nodeVersion: 'v22.0.0', ci: null },
    terminationStatus: 'failed',
    summary: null,
    ...overrides
  }
}

function makeAnnotation(
  targetEventId: string
): Extract<ObservationAnnotation, { annotationKind: 'disposition' }> {
  return {
    schemaVersion: 1,
    annotationId: randomUUID(),
    targetEventId,
    recordedAt: '2026-09-19T12:01:00.000Z',
    author: { kind: 'human', id: 'reviewer' },
    publicationClass: 'synthetic',
    annotationKind: 'disposition',
    disposition: 'unresolved',
    duplicateOfEventId: null,
    evidence: null,
    note: null
  }
}

function makeStart(event: RawObservation): RawObservation {
  return {
    ...event,
    eventId: randomUUID(),
    eventKind: 'campaign-started',
    replayPath: null,
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
    terminationStatus: 'started',
    summary: null
  }
}

function makeCompletion(event: RawObservation): RawObservation {
  return {
    ...event,
    eventId: randomUUID(),
    eventKind: 'campaign-completed',
    counterexample: null,
    counterexampleHash: null,
    counterexampleCaptureStatus: null,
    counterexampleCaptureError: null,
    incidentFingerprint: null,
    terminationStatus: 'failed',
    summary: {
      requestedRuns: event.requestedRuns,
      executedRuns: event.executedRuns ?? 0,
      generatedCases: event.generatedCases ?? 0,
      skippedCases: event.skippedCases ?? 0,
      failureCount: 1
    }
  }
}

function runWriter(workerPath: string, root: string, event: RawObservation): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, root, JSON.stringify(event)], {
      stdio: 'pipe'
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += String(chunk)))
    child.once('error', reject)
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr))))
  })
}

describe('PBT observation store', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'starfolio-pbt-store-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps repeated incidents as unique immutable occurrences', () => {
    const first = makeEvent()
    const second = makeEvent()

    appendRawObservation(root, first)
    appendRawObservation(root, second)

    const result = readObservationStore(root)
    expect(result.rawEvents.map((event) => event.eventId)).toEqual(
      [first.eventId, second.eventId].sort()
    )
    expect(new Set(result.rawEvents.map((event) => event.incidentFingerprint))).toEqual(
      new Set([first.incidentFingerprint])
    )
    expect(result.diagnostics.filter((entry) => entry.kind === 'malformed')).toEqual([])
  })

  it('does not overwrite an existing event id', () => {
    const event = makeEvent()
    appendRawObservation(root, event)

    expect(() => appendRawObservation(root, { ...event, failureText: 'changed' })).toThrow(
      /already exists/
    )
    const snapshot = readObservationStore(root)
    expect(snapshot.rawEvents[0].failureText).toBe(event.failureText)
    expect(snapshot.diagnostics.filter((entry) => entry.kind === 'malformed')).toEqual([])
  })

  it('quarantines failures with forged semantic hashes', () => {
    const event = makeEvent({ counterexampleHash: 'a'.repeat(64) })
    appendRawObservation(root, event)

    const snapshot = readObservationStore(root)

    expect(snapshot.rawEvents).toEqual([])
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'malformed', message: expect.stringMatching(/hash/i) })
      ])
    )
  })

  it('accepts concurrent process writers without losing events', async () => {
    const workerPath = join(root, 'writer.cjs')
    buildSync({
      entryPoints: [join(__dirname, 'observation-writer.fixture.ts')],
      outfile: workerPath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent'
    })
    const events = Array.from({ length: 12 }, () => makeEvent())

    await Promise.all(events.map((event) => runWriter(workerPath, root, event)))

    expect(readObservationStore(root).rawEvents).toHaveLength(events.length)
  }, 15_000)

  it('preserves partial and malformed files while reading valid neighbors', () => {
    const valid = makeEvent()
    appendRawObservation(root, valid)
    const rawDir = join(root, 'raw')
    writeFileSync(join(rawDir, '.interrupted.tmp'), '{"schemaVersion":1')
    writeFileSync(join(rawDir, `${randomUUID()}.json`), '{not json')

    const result = readObservationStore(root)

    expect(result.rawEvents).toEqual([valid])
    expect(
      result.diagnostics
        .map((entry) => entry.kind)
        .filter((kind) => kind === 'malformed' || kind === 'partial')
        .sort()
    ).toEqual(['malformed', 'partial'])
    expect(existsSync(join(rawDir, '.interrupted.tmp'))).toBe(true)
  })

  it('links append-only annotations without changing raw bytes', () => {
    const event = makeEvent()
    appendRawObservation(root, event)
    const rawPath = join(root, 'raw', `${event.eventId}.json`)
    const before = readFileSync(rawPath, 'utf8')

    const annotation = makeAnnotation(event.eventId)
    appendAnnotation(root, annotation)

    const result = readObservationStore(root)
    expect(result.annotations).toEqual([annotation])
    expect(result.diagnostics.filter((entry) => entry.kind === 'broken-link')).toEqual([])
    expect(readFileSync(rawPath, 'utf8')).toBe(before)
  })

  it('reports schema-valid annotations with broken links', () => {
    const annotation = makeAnnotation(randomUUID())
    const annotationDir = join(root, 'annotations')
    mkdirSync(annotationDir, { recursive: true })
    writeFileSync(
      join(annotationDir, `${annotation.annotationId}.json`),
      JSON.stringify(annotation)
    )

    expect(readObservationStore(root).diagnostics.map((entry) => entry.kind)).toContain(
      'broken-link'
    )
  })

  it('rejects annotation links absent from the known ledger', () => {
    const event = makeEvent()
    const annotation = makeAnnotation(randomUUID())
    appendRawObservation(root, event)

    expect(() => appendAnnotation(root, annotation)).toThrow(/annotation target/)
    expect(() =>
      appendAnnotation(root, {
        ...annotation,
        annotationId: randomUUID(),
        targetEventId: event.eventId,
        disposition: 'duplicate',
        duplicateOfEventId: randomUUID()
      })
    ).toThrow(/duplicate target/)
  })

  it('accepts links to retained events supplied by a ledger reader', () => {
    const retainedEventId = randomUUID()
    const annotation = makeAnnotation(retainedEventId)

    appendAnnotation(root, annotation, { knownEventIds: [retainedEventId] })

    expect(readObservationStore(root, { knownEventIds: [retainedEventId] })).toMatchObject({
      annotations: [annotation],
      diagnostics: []
    })
  })

  it('reports duplicate annotation identities', () => {
    const event = makeEvent()
    const annotation = makeAnnotation(event.eventId)
    appendRawObservation(root, event)
    appendAnnotation(root, annotation)
    writeFileSync(join(root, 'annotations', `${randomUUID()}.json`), JSON.stringify(annotation))

    expect(readObservationStore(root).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'malformed',
          message: `Duplicate annotation id ${annotation.annotationId}`
        })
      ])
    )
  })

  it('orders records without locale-sensitive comparison', () => {
    appendRawObservation(root, makeEvent())
    appendRawObservation(root, makeEvent())
    const localeCompare = String.prototype.localeCompare
    String.prototype.localeCompare = () => {
      throw new Error('locale comparison used')
    }

    try {
      expect(() => readObservationStore(root)).not.toThrow()
    } finally {
      String.prototype.localeCompare = localeCompare
    }
  })

  it('diagnoses contradictory campaign lifecycles and summaries', () => {
    const failure = makeEvent()
    const start = makeStart(failure)
    const duplicateStart = { ...start, eventId: randomUUID() }
    const completion = {
      ...makeCompletion(failure),
      property: { ...failure.property, version: '2' },
      terminationStatus: 'passed' as const,
      replayPath: null,
      executedRuns: 200,
      generatedCases: 200,
      skippedCases: 0,
      failureText: null,
      failureTextCaptureStatus: null,
      failureTextCaptureError: null,
      summary: {
        requestedRuns: 200,
        executedRuns: 200,
        generatedCases: 200,
        skippedCases: 0,
        failureCount: 0
      }
    }
    for (const event of [start, duplicateStart, failure, completion])
      appendRawObservation(root, event)

    const messages = readObservationStore(root)
      .diagnostics.filter((entry) => entry.kind === 'inconsistent-campaign')
      .map((entry) => entry.message)

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/multiple campaign starts/),
        expect.stringMatching(/property metadata changed/),
        expect.stringMatching(/passed campaign has failures/),
        expect.stringMatching(/failure count does not match/)
      ])
    )
  })

  it('diagnoses missing campaign boundaries', () => {
    const failure = makeEvent()
    appendRawObservation(root, failure)

    const messages = readObservationStore(root)
      .diagnostics.filter((entry) => entry.kind === 'inconsistent-campaign')
      .map((entry) => entry.message)

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/missing campaign start/),
        expect.stringMatching(/missing campaign completion/)
      ])
    )
  })

  it('accepts an interrupted campaign with no failed case', () => {
    const base = makeEvent()
    const start = makeStart(base)
    const completion = {
      ...makeCompletion(base),
      terminationStatus: 'interrupted' as const,
      failureText: null,
      failureTextCaptureStatus: null,
      failureTextCaptureError: null,
      summary: {
        requestedRuns: 200,
        executedRuns: 7,
        generatedCases: 10,
        skippedCases: 3,
        failureCount: 0
      }
    }
    appendRawObservation(root, start)
    appendRawObservation(root, completion)

    expect(
      readObservationStore(root).diagnostics.map((diagnostic) => diagnostic.message)
    ).not.toContain('failed campaign has no failure observation')
  })

  it('diagnoses failure and completion denominator drift', () => {
    const failure = makeEvent()
    appendRawObservation(root, makeStart(failure))
    appendRawObservation(root, failure)
    appendRawObservation(
      root,
      makeCompletion({
        ...failure,
        executedRuns: 8,
        generatedCases: 11
      })
    )

    expect(
      readObservationStore(root).diagnostics.map((diagnostic) => diagnostic.message)
    ).toContain('failure and completion facts differ')
  })

  it.each([
    ['replay path', { replayPath: '0:2' }],
    ['failure text', { failureText: 'different failure' }]
  ] as const)('diagnoses failure and completion %s drift', (_label, overrides) => {
    const failure = makeEvent()
    appendRawObservation(root, makeStart(failure))
    appendRawObservation(root, failure)
    appendRawObservation(root, makeCompletion({ ...failure, ...overrides }))

    expect(
      readObservationStore(root).diagnostics.map((diagnostic) => diagnostic.message)
    ).toContain('failure and completion facts differ')
  })

  it('uses explicit nulls when repository and CI provenance are unavailable', () => {
    expect(
      collectObservationProvenance({
        env: {},
        cwd: root,
        readGit: () => null,
        platform: 'linux',
        arch: 'x64',
        nodeVersion: 'v22.0.0'
      })
    ).toEqual({
      repository: { sha: null, branch: null, worktree: null },
      ci: { provider: null, runId: null, runAttempt: null, workflow: null, job: null },
      environment: { platform: 'linux', arch: 'x64', nodeVersion: 'v22.0.0', ci: null }
    })
  })

  it('keeps unrecognized CI values unknown', () => {
    for (const value of ['1', 'yes', '']) {
      expect(
        collectObservationProvenance({
          env: { CI: value },
          cwd: root,
          readGit: () => null
        }).environment.ci
      ).toBeNull()
    }
  })

  it('uses authoritative workflow provenance overrides', () => {
    const provenance = collectObservationProvenance({
      env: {
        GITHUB_ACTIONS: 'true',
        GITHUB_SHA: 'merge-sha',
        GITHUB_REF_NAME: 'merge-ref',
        PBT_REPOSITORY_SHA: 'head-sha',
        PBT_REPOSITORY_BRANCH: 'feature/pbt'
      },
      cwd: root,
      readGit: () => null
    })

    expect(provenance.repository).toEqual({
      sha: 'head-sha',
      branch: 'feature/pbt',
      worktree: null
    })
  })

  it('keeps unavailable agent provenance explicitly unknown', () => {
    expect(collectAgentProvenance({})).toEqual({
      runId: null,
      stepId: null,
      worktreeState: 'unknown',
      worktreeStateHash: null
    })
  })

  it('reads agent provenance only from the command boundary', () => {
    expect(
      collectAgentProvenance({
        PBT_AGENT_RUN_ID: 'agent-run-1',
        PBT_AGENT_STEP_ID: 'step-1',
        PBT_WORKTREE_STATE: 'dirty',
        PBT_WORKTREE_STATE_HASH: 'a'.repeat(64)
      })
    ).toEqual({
      runId: 'agent-run-1',
      stepId: 'step-1',
      worktreeState: 'dirty',
      worktreeStateHash: 'a'.repeat(64)
    })
  })
})
