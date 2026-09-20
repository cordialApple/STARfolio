import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readObservationStore } from './observation-store'
import {
  defineSyntheticOrganicProperty,
  runProperty,
  replayRegression,
  fc,
  type PropertyMetadata
} from './pbt'

function metadata(overrides: Partial<PropertyMetadata> = {}): PropertyMetadata {
  return {
    id: 'self/example',
    version: '1',
    invariant: 'self-test invariant',
    observationClass: 'sabotage',
    publicationClass: 'synthetic',
    ...overrides
  }
}

describe('pbt harness self-test', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'starfolio-pbt-harness-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('defines synthetic organic property metadata', () => {
    expect(defineSyntheticOrganicProperty('self/property', '2', 'value stays stable')).toEqual({
      id: 'self/property',
      version: '2',
      invariant: 'value stays stable',
      observationClass: 'organic',
      publicationClass: 'synthetic'
    })
  })

  it('records a zero-failure campaign with its requested and executed denominator', () => {
    runProperty(metadata(), fc.integer(), () => true, { runs: 7, seed: 12, observationRoot: root })

    const events = readObservationStore(root).rawEvents
    expect(events.map((event) => event.eventKind)).toEqual([
      'campaign-started',
      'campaign-completed'
    ])
    expect(events[1]).toMatchObject({
      requestedRuns: 7,
      executedRuns: 7,
      generatedCases: 7,
      skippedCases: 0,
      terminationStatus: 'passed',
      summary: {
        requestedRuns: 7,
        executedRuns: 7,
        generatedCases: 7,
        skippedCases: 0,
        failureCount: 0
      }
    })
  })

  it('keeps repeated failures with stable fingerprints and unique occurrence ids', () => {
    const run = (): void =>
      runProperty(metadata(), fc.integer({ min: 1, max: 100 }), (value) => value < 0, {
        runs: 20,
        seed: 17,
        observationRoot: root
      })

    expect(run).toThrow(/pbt\(self\/example\) failed/)
    expect(run).toThrow(/pbt\(self\/example\) failed/)

    const failures = readObservationStore(root).rawEvents.filter(
      (event) => event.eventKind === 'failure-observed'
    )
    expect(failures).toHaveLength(2)
    expect(new Set(failures.map((event) => event.eventId)).size).toBe(2)
    expect(new Set(failures.map((event) => event.campaignId)).size).toBe(2)
    expect(new Set(failures.map((event) => event.incidentFingerprint).filter(Boolean)).size).toBe(1)
  })

  it('records replay metadata and exact failure text', () => {
    expect(() =>
      runProperty(
        metadata(),
        fc.integer({ min: 1, max: 100 }),
        (value) => {
          throw new Error(`observed ${value}`)
        },
        { runs: 50, seed: 99, observationRoot: root }
      )
    ).toThrow(/seed=99/)

    const failure = readObservationStore(root).rawEvents.find(
      (event) => event.eventKind === 'failure-observed'
    )
    expect(failure).toMatchObject({
      seed: 99,
      requestedRuns: 50,
      executedRuns: 1,
      generatedCases: 1,
      skippedCases: 0,
      counterexample: [1],
      terminationStatus: 'failed'
    })
    expect(failure?.replayPath).toEqual(expect.any(String))
    expect(failure?.shrinkCount).toEqual(expect.any(Number))
    expect(failure?.failureText).toBe('Error: observed 1')
    expect(failure?.counterexampleCaptureStatus).toBe('captured')
    expect(failure?.failureTextCaptureStatus).toBe('captured')
  })

  it('records counterexample capture failure without a false fingerprint', () => {
    const value = (): number => 1

    expect(() =>
      runProperty(metadata(), fc.constant(value), () => false, {
        runs: 1,
        seed: 23,
        observationRoot: root
      })
    ).toThrow(/pbt\(self\/example\) failed/)

    const events = readObservationStore(root).rawEvents
    const failure = events.find((event) => event.eventKind === 'failure-observed')
    expect(failure).toMatchObject({
      counterexample: null,
      counterexampleHash: null,
      incidentFingerprint: null,
      counterexampleCaptureStatus: 'failed'
    })
    expect(failure?.counterexampleCaptureError).toEqual(expect.any(String))
    expect(events.find((event) => event.eventKind === 'campaign-completed')).toBeDefined()
  })

  it('records events when a thrown value rejects text conversion', () => {
    const hostile = {
      [Symbol.toPrimitive](): never {
        throw new Error('coercion blocked')
      }
    }

    expect(() =>
      runProperty(
        metadata(),
        fc.constant(1),
        () => {
          throw hostile
        },
        { runs: 1, seed: 31, observationRoot: root }
      )
    ).toThrow(/failure text unavailable/)

    const events = readObservationStore(root).rawEvents
    const failure = events.find((event) => event.eventKind === 'failure-observed')
    const completion = events.find((event) => event.eventKind === 'campaign-completed')
    expect(failure).toMatchObject({
      failureText: null,
      failureTextCaptureStatus: 'failed',
      failureTextCaptureError: 'Error: coercion blocked'
    })
    expect(completion).toMatchObject({
      failureText: null,
      failureTextCaptureStatus: 'failed',
      failureTextCaptureError: 'Error: coercion blocked'
    })
  })

  it('records generated and skipped cases with a report when preconditions exhaust', () => {
    expect(() =>
      runProperty(
        metadata(),
        fc.integer(),
        () => {
          fc.pre(false)
          return true
        },
        { runs: 2, seed: 9, observationRoot: root }
      )
    ).toThrow(/too many pre-condition failures/)

    const events = readObservationStore(root).rawEvents
    const failure = events.find((event) => event.eventKind === 'failure-observed')
    const completion = events.find((event) => event.eventKind === 'campaign-completed')
    expect(failure?.failureText).toMatch(/too many pre-condition failures/i)
    expect(failure?.skippedCases).toBeGreaterThan(0)
    expect(failure?.generatedCases).toBe(
      (failure?.executedRuns ?? 0) + (failure?.skippedCases ?? 0)
    )
    expect(completion?.summary?.generatedCases).toBe(failure?.generatedCases)
    expect(completion?.summary?.skippedCases).toBe(failure?.skippedCases)
  })

  it('records one normalized seed across the campaign', () => {
    runProperty(metadata(), fc.integer(), () => true, {
      runs: 1,
      seed: 2_147_483_648,
      observationRoot: root
    })

    const events = readObservationStore(root).rawEvents
    expect(new Set(events.map((event) => event.seed))).toEqual(new Set([-2_147_483_648]))
    expect(events.flatMap((event) => event.eventKind)).toContain('campaign-completed')
    expect(readObservationStore(root).diagnostics).toEqual([])
  })

  it('keeps the property report when persistence fails after observation', () => {
    expect(() =>
      runProperty(
        metadata(),
        fc.constant(1),
        () => {
          rmSync(root, { recursive: true, force: true })
          writeFileSync(root, 'blocked')
          throw new Error('original property failure')
        },
        { runs: 1, seed: 7, observationRoot: root }
      )
    ).toThrow(/original property failure[\s\S]*persistence/i)
  })

  it('preserves organic, mutation, and sabotage observation classes', () => {
    for (const observationClass of ['organic', 'mutation', 'sabotage'] as const) {
      runProperty(
        metadata({ id: `self/${observationClass}`, observationClass }),
        fc.constant(1),
        () => true,
        {
          runs: 1,
          observationRoot: root
        }
      )
    }

    const starts = readObservationStore(root).rawEvents.filter(
      (event) => event.eventKind === 'campaign-started'
    )
    expect(starts.map((event) => event.observationClass).sort()).toEqual([
      'mutation',
      'organic',
      'sabotage'
    ])
  })

  it('restores Math.random and Date.now even when a property fails', () => {
    const random = Math.random
    const now = Date.now
    expect(() =>
      runProperty(metadata(), fc.constant(0), () => false, { observationRoot: root })
    ).toThrow()
    expect(Math.random).toBe(random)
    expect(Date.now).toBe(now)
  })

  it('bans Math.random inside a property body', () => {
    expect(() =>
      runProperty(metadata(), fc.constant(0), () => Math.random() >= 0, { observationRoot: root })
    ).toThrow(/Math\.random\(\) is banned/)
  })

  it('replayRegression rethrows a case that still fails', () => {
    expect(() => replayRegression('self/regress', [1, 2], (value) => value > 10)).toThrow(
      /case 0 still fails/
    )
    expect(() => replayRegression('self/regress-ok', [1, 2], (value) => value > 0)).not.toThrow()
  })
})
