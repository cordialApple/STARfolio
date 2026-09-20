import { describe, expect, it } from 'vitest'
import {
  agentProvenanceSchema,
  annotationSchema,
  rawObservationSchema,
  type RawObservation
} from './observation-schema'
import { hashCanonicalValue, toTaggedValue } from './observation-canonical'

const baseEvent: RawObservation = {
  schemaVersion: 1,
  eventId: 'd499ca1e-bb79-4a93-93ed-d652b170f23c',
  campaignId: '9482051d-ef39-4464-bcf5-8c3bb7c67d0e',
  eventKind: 'campaign-started',
  observedAt: '2026-09-19T12:00:00.000Z',
  repository: { sha: null, branch: null, worktree: null },
  ci: { provider: null, runId: null, runAttempt: null, workflow: null, job: null },
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
  environment: { platform: 'win32', arch: 'x64', nodeVersion: 'v22.0.0', ci: null },
  terminationStatus: 'started',
  summary: null
}

describe('PBT observation schema', () => {
  it('accepts explicit null provenance without inventing values', () => {
    expect(rawObservationSchema.parse(baseEvent)).toEqual(baseEvent)
  })

  it('keeps version 1 readable and requires explicit version 2 agent provenance', () => {
    const agent = {
      runId: 'agent-run-1',
      stepId: 'step-1',
      worktreeState: 'dirty' as const,
      worktreeStateHash: 'a'.repeat(64)
    }
    const event = { ...baseEvent, schemaVersion: 2 as const, agent }

    expect(rawObservationSchema.parse(baseEvent)).toEqual(baseEvent)
    expect(rawObservationSchema.parse(event)).toEqual(event)
    expect(() => rawObservationSchema.parse({ ...event, agent: { ...agent, stepId: undefined } }))
      .toThrow()
    expect(() => rawObservationSchema.parse({ ...event, agent: { ...agent, worktreeStateHash: null } }))
      .toThrow(/hash/)
  })

  it('requires unknown worktree state to use an explicit null hash', () => {
    expect(
      agentProvenanceSchema.parse({
        runId: null,
        stepId: null,
        worktreeState: 'unknown',
        worktreeStateHash: null
      })
    ).toEqual({
      runId: null,
      stepId: null,
      worktreeState: 'unknown',
      worktreeStateHash: null
    })
    expect(() =>
      agentProvenanceSchema.parse({
        runId: null,
        stepId: null,
        worktreeState: 'unknown',
        worktreeStateHash: 'b'.repeat(64)
      })
    ).toThrow(/unknown/i)
  })

  it('rejects missing required provenance fields', () => {
    const repository = { ...baseEvent.repository } as Record<string, string | null>
    delete repository.branch

    expect(() => rawObservationSchema.parse({ ...baseEvent, repository })).toThrow()
  })

  it('rejects event fields that contradict the event kind', () => {
    expect(() => rawObservationSchema.parse({ ...baseEvent, executedRuns: 1 })).toThrow()
    expect(() =>
      rawObservationSchema.parse({
        ...baseEvent,
        eventKind: 'failure-observed',
        executedRuns: 1,
        shrinkCount: 0,
        terminationStatus: 'failed'
      })
    ).toThrow(/capture status/)
    expect(() =>
      rawObservationSchema.parse({
        ...baseEvent,
        eventKind: 'campaign-completed',
        executedRuns: 1,
        terminationStatus: 'passed'
      })
    ).toThrow(/summary/)
  })

  it('rejects run counts beyond the requested denominator', () => {
    expect(() =>
      rawObservationSchema.parse({
        ...baseEvent,
        eventKind: 'campaign-completed',
        executedRuns: 201,
        generatedCases: 201,
        skippedCases: 0,
        shrinkCount: 0,
        terminationStatus: 'failed',
        failureText: 'failure',
        failureTextCaptureStatus: 'captured',
        summary: {
          requestedRuns: 200,
          executedRuns: 201,
          generatedCases: 201,
          skippedCases: 0,
          failureCount: 1
        }
      })
    ).toThrow(/requested/)
  })

  it('requires passed campaigns to execute every requested run', () => {
    expect(() =>
      rawObservationSchema.parse({
        ...baseEvent,
        eventKind: 'campaign-completed',
        executedRuns: 199,
        generatedCases: 199,
        skippedCases: 0,
        shrinkCount: 0,
        terminationStatus: 'passed',
        summary: {
          requestedRuns: 200,
          executedRuns: 199,
          generatedCases: 199,
          skippedCases: 0,
          failureCount: 0
        }
      })
    ).toThrow(/requested/)
  })

  it('binds completion failure counts to termination status', () => {
    const completion = {
      ...baseEvent,
      eventKind: 'campaign-completed' as const,
      executedRuns: 200,
      generatedCases: 200,
      skippedCases: 0,
      shrinkCount: 0,
      terminationStatus: 'passed' as const,
      summary: {
        requestedRuns: 200,
        executedRuns: 200,
        generatedCases: 200,
        skippedCases: 0,
        failureCount: 1
      }
    }

    expect(() => rawObservationSchema.parse(completion)).toThrow(/failure count/)
    expect(() =>
      rawObservationSchema.parse({
        ...completion,
        terminationStatus: 'failed',
        failureText: 'failed',
        failureTextCaptureStatus: 'captured',
        summary: { ...completion.summary, failureCount: 0 }
      })
    ).toThrow(/failure count/)
  })

  it('enforces failure capture status and payload consistency', () => {
    const failure = {
      ...baseEvent,
      eventKind: 'failure-observed' as const,
      executedRuns: 1,
      generatedCases: 1,
      skippedCases: 0,
      shrinkCount: 0,
      counterexample: [1],
      counterexampleHash: 'a'.repeat(64),
      counterexampleCaptureStatus: 'captured' as const,
      incidentFingerprint: 'b'.repeat(64),
      failureText: 'failure',
      failureTextCaptureStatus: 'captured' as const,
      terminationStatus: 'failed' as const
    }

    expect(rawObservationSchema.parse(failure)).toEqual(failure)
    expect(() =>
      rawObservationSchema.parse({ ...failure, counterexampleCaptureStatus: 'absent' })
    ).toThrow(/absent/)
    expect(() =>
      rawObservationSchema.parse({ ...failure, failureTextCaptureStatus: 'failed' })
    ).toThrow(/Failed/)
  })

  it('accepts explicit counterexample capture failure without a fingerprint', () => {
    expect(() =>
      rawObservationSchema.parse({
        ...baseEvent,
        eventKind: 'failure-observed',
        executedRuns: 1,
        generatedCases: 1,
        skippedCases: 0,
        shrinkCount: 0,
        counterexampleCaptureStatus: 'failed',
        counterexampleCaptureError: 'unsupported function',
        failureText: 'failure',
        failureTextCaptureStatus: 'captured',
        terminationStatus: 'failed'
      })
    ).not.toThrow()
  })

  it('keeps dispositions in a separate annotation record', () => {
    expect(
      annotationSchema.parse({
        schemaVersion: 1,
        annotationId: '6766ab2c-c8dd-4ca1-a424-e3fa59715b90',
        targetEventId: baseEvent.eventId,
        recordedAt: '2026-09-19T12:01:00.000Z',
        author: { kind: 'human', id: 'reviewer' },
        publicationClass: 'unknown',
        annotationKind: 'disposition',
        disposition: 'unresolved',
        duplicateOfEventId: null,
        evidence: null,
        note: null
      })
    ).toMatchObject({ annotationKind: 'disposition', disposition: 'unresolved' })
    expect(() => rawObservationSchema.parse({ ...baseEvent, disposition: 'unresolved' })).toThrow()
  })

  it('requires typed evidence for confirmed defects and a target for duplicates', () => {
    const annotation = {
      schemaVersion: 1 as const,
      annotationId: '6766ab2c-c8dd-4ca1-a424-e3fa59715b90',
      targetEventId: baseEvent.eventId,
      recordedAt: '2026-09-19T12:01:00.000Z',
      author: { kind: 'human' as const, id: 'reviewer' },
      publicationClass: 'unknown' as const,
      annotationKind: 'disposition' as const,
      disposition: 'confirmed-code-bug' as const,
      duplicateOfEventId: null,
      evidence: null,
      note: null
    }

    expect(() => annotationSchema.parse(annotation)).toThrow(/evidence/)
    expect(
      annotationSchema.parse({
        ...annotation,
        evidence: { kind: 'adjudication', url: 'https://github.com/example/review/1' }
      })
    ).toMatchObject({ annotationKind: 'disposition', disposition: 'confirmed-code-bug' })
    expect(() =>
      annotationSchema.parse({
        ...annotation,
        disposition: 'duplicate',
        evidence: null
      })
    ).toThrow(/Duplicate target/)
    expect(() =>
      annotationSchema.parse({
        ...annotation,
        disposition: 'unresolved',
        duplicateOfEventId: 'f59def18-75cb-4b79-9f65-b23eef8051d7'
      })
    ).toThrow(/only valid for duplicate/)
  })

  it('rejects payload fields from another annotation kind', () => {
    const common = {
      schemaVersion: 1 as const,
      annotationId: '6766ab2c-c8dd-4ca1-a424-e3fa59715b90',
      targetEventId: baseEvent.eventId,
      recordedAt: '2026-09-19T12:01:00.000Z',
      author: { kind: 'human' as const, id: 'reviewer' },
      publicationClass: 'synthetic' as const,
      note: null
    }

    expect(() =>
      annotationSchema.parse({
        ...common,
        annotationKind: 'classification',
        classification: 'needs-review',
        evidence: null,
        correction: { seed: 1 }
      })
    ).toThrow()
    expect(
      annotationSchema.parse({
        ...common,
        annotationKind: 'correction',
        correction: { seed: 1 }
      }).annotationKind
    ).toBe('correction')
  })

  it('requires evidence for a confirmed classification', () => {
    const classification = {
      schemaVersion: 1 as const,
      annotationId: '6766ab2c-c8dd-4ca1-a424-e3fa59715b90',
      targetEventId: baseEvent.eventId,
      recordedAt: '2026-09-19T12:01:00.000Z',
      author: { kind: 'agent' as const, id: 'reviewer' },
      publicationClass: 'synthetic' as const,
      annotationKind: 'classification' as const,
      classification: 'confirmed-code-bug',
      evidence: null,
      note: null
    }

    expect(() => annotationSchema.parse(classification)).toThrow(/evidence/)
    expect(() =>
      annotationSchema.parse({
        ...classification,
        classification: 'confirmed-oracle-bug'
      })
    ).toThrow(/evidence/)
    expect(() =>
      annotationSchema.parse({
        ...classification,
        classification: 'CONFIRMED',
        evidence: { kind: 'adjudication', url: 'https://github.com/example/review/3' }
      })
    ).not.toThrow()
    expect(() =>
      annotationSchema.parse({
        ...classification,
        evidence: { kind: 'review', url: 'https://github.com/example/review/2' }
      })
    ).not.toThrow()
  })

  it('rejects self-referential duplicate links', () => {
    expect(() =>
      annotationSchema.parse({
        schemaVersion: 1,
        annotationId: '6766ab2c-c8dd-4ca1-a424-e3fa59715b90',
        targetEventId: baseEvent.eventId,
        recordedAt: '2026-09-19T12:01:00.000Z',
        author: { kind: 'human', id: 'reviewer' },
        publicationClass: 'synthetic',
        annotationKind: 'duplicate-link',
        duplicateOfEventId: baseEvent.eventId,
        note: null
      })
    ).toThrow(/itself/)
  })
})

describe('PBT canonical values', () => {
  it('hashes equivalent object content identically', () => {
    expect(hashCanonicalValue({ a: 1, b: [2, 3] })).toBe(hashCanonicalValue({ b: [2, 3], a: 1 }))
  })

  it('preserves typed arrays and non-JSON primitives with tags', () => {
    expect(toTaggedValue(new Float32Array([1.5, -2]))).toEqual({
      $type: 'Float32Array',
      values: [1.5, -2]
    })
    expect(toTaggedValue({ missing: undefined, count: 2n })).toEqual({
      $type: 'object',
      entries: [
        ['count', { $type: 'bigint', value: '2' }],
        ['missing', { $type: 'undefined' }]
      ]
    })
  })

  it('keeps reserved-looking objects and map contents collision-free', () => {
    expect(hashCanonicalValue(undefined)).not.toBe(hashCanonicalValue({ $type: 'undefined' }))
    expect(hashCanonicalValue(new Map([['key', 1]]))).not.toBe(
      hashCanonicalValue(new Map([['key', 2]]))
    )
  })

  it('preserves negative zero as a distinct counterexample', () => {
    expect(toTaggedValue(-0)).toEqual({ $type: 'number', value: '-0' })
    expect(hashCanonicalValue(-0)).not.toBe(hashCanonicalValue(0))
  })

  it('preserves error, non-enumerable, and symbol-keyed state', () => {
    const first = new Error('first')
    const second = new Error('second')
    expect(hashCanonicalValue(first)).not.toBe(hashCanonicalValue(second))

    const hiddenOne = {}
    const hiddenTwo = {}
    Object.defineProperty(hiddenOne, 'value', { value: 1 })
    Object.defineProperty(hiddenTwo, 'value', { value: 2 })
    expect(hashCanonicalValue(hiddenOne)).not.toBe(hashCanonicalValue(hiddenTwo))

    const key = Symbol.for('key')
    expect(hashCanonicalValue({ [key]: 1 })).not.toBe(hashCanonicalValue({ [key]: 2 }))
  })

  it('preserves sparse array holes and numeric descriptors', () => {
    const sparse = new Array(3)
    Object.defineProperty(sparse, '1', {
      value: undefined,
      enumerable: true,
      configurable: false,
      writable: false
    })

    expect(toTaggedValue(sparse)).toEqual({
      $type: 'Array',
      length: 3,
      lengthWritable: true,
      properties: [
        {
          key: { $type: 'string-key', value: '1' },
          enumerable: true,
          configurable: false,
          kind: 'data',
          writable: false,
          value: { $type: 'undefined' }
        }
      ]
    })
  })

  it('rejects values whose identity cannot be serialized faithfully', () => {
    const shared = { value: 1 }
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    const First = class Same {}
    const Second = class Same {}

    expect(() => toTaggedValue(() => 1)).toThrow(/functions/)
    expect(() => toTaggedValue(Symbol('local'))).toThrow(/local symbols/)
    expect(() => toTaggedValue({ [Symbol('local-key')]: 1 })).toThrow(/local symbols/)
    expect(() => toTaggedValue([shared, shared])).toThrow(/shared references/)
    expect(() => toTaggedValue(cyclic)).toThrow(/cycles/)
    expect(() => toTaggedValue(new First())).toThrow(/custom object prototypes/)
    expect(() => toTaggedValue(new Second())).toThrow(/custom object prototypes/)
    expect(() => toTaggedValue(new URL('https://example.com'))).toThrow(/URL identity/)
    expect(() => toTaggedValue(Object.create(null))).toThrow(/custom object prototypes/)
  })

  it('encodes global symbols without losing identity', () => {
    expect(toTaggedValue(Symbol.for('stable'))).toEqual({
      $type: 'symbol',
      globalKey: 'stable'
    })
    expect(toTaggedValue({ [Symbol.for('stable')]: 1 })).toEqual({
      $type: 'object',
      name: null,
      properties: [
        {
          key: { $type: 'symbol-key', globalKey: 'stable' },
          enumerable: true,
          configurable: true,
          kind: 'data',
          writable: true,
          value: 1
        }
      ]
    })
  })

  it('orders property keys without locale-dependent comparison', () => {
    const value = {}
    Object.defineProperty(value, 'ä', { value: 1 })
    Object.defineProperty(value, 'z', { value: 2 })
    const localeCompare = String.prototype.localeCompare
    String.prototype.localeCompare = () => {
      throw new Error('locale comparison used')
    }

    try {
      expect(() => toTaggedValue(value)).not.toThrow()
    } finally {
      String.prototype.localeCompare = localeCompare
    }
  })
})
