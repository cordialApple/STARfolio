import { randomUUID } from 'crypto'
import fc from 'fast-check'
import { createIncidentFingerprint, hashTaggedValue, toTaggedValue } from './observation-canonical'
import type {
  ObservationClass,
  PropertyIdentity,
  PublicationClass,
  RawObservation
} from './observation-schema'
import {
  appendRawObservation,
  collectAgentProvenance,
  collectObservationProvenance,
  resolveObservationRoot
} from './observation-store'

export const PBT_SEED = Number(process.env.PBT_SEED ?? 202607)
export const PBT_RUNS = Number(process.env.PBT_RUNS ?? 200)
export const PBT_HARNESS_VERSION = '4'

export interface PropertyMetadata extends PropertyIdentity {
  observationClass: ObservationClass
  publicationClass: PublicationClass
}

export interface PropertyOptions {
  runs?: number
  seed?: number
  observationRoot?: string
}

type TextCapture = Pick<
  RawObservation,
  'failureText' | 'failureTextCaptureStatus' | 'failureTextCaptureError'
>

function captureConversionError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return 'Text conversion threw'
  }
}

function captureText(value: unknown): TextCapture {
  try {
    return {
      failureText: String(value),
      failureTextCaptureStatus: 'captured',
      failureTextCaptureError: null
    }
  } catch (error) {
    return {
      failureText: null,
      failureTextCaptureStatus: 'failed',
      failureTextCaptureError: captureConversionError(error)
    }
  }
}

function captureRunFailure<T>(details: fc.RunDetails<T>): TextCapture {
  if (details.errorInstance !== null) return captureText(details.errorInstance)
  try {
    return captureText(fc.defaultReportMessage(details))
  } catch (error) {
    const captured = captureText(error)
    return {
      failureText: null,
      failureTextCaptureStatus: 'failed',
      failureTextCaptureError: captured.failureText ?? captured.failureTextCaptureError
    }
  }
}

export function defineSyntheticProperty(
  id: string,
  version: string,
  invariant: string,
  observationClass: ObservationClass
): PropertyMetadata {
  return { id, version, invariant, observationClass, publicationClass: 'synthetic' }
}

export function defineSyntheticOrganicProperty(
  id: string,
  version: string,
  invariant: string
): PropertyMetadata {
  return defineSyntheticProperty(id, version, invariant, 'organic')
}

function createEvent(
  metadata: PropertyMetadata,
  campaignId: string,
  seed: number,
  requestedRuns: number,
  provenance: ReturnType<typeof collectObservationProvenance> & {
    agent: ReturnType<typeof collectAgentProvenance>
  },
  overrides: Partial<RawObservation>
): RawObservation {
  return {
    schemaVersion: 2,
    eventId: randomUUID(),
    campaignId,
    eventKind: 'campaign-started',
    observedAt: new Date().toISOString(),
    ...provenance,
    property: { id: metadata.id, version: metadata.version, invariant: metadata.invariant },
    harnessVersion: PBT_HARNESS_VERSION,
    observationClass: metadata.observationClass,
    publicationClass: metadata.publicationClass,
    seed,
    replayPath: null,
    requestedRuns,
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
    summary: null,
    ...overrides
  }
}

function appendObservedEvent(
  root: string,
  event: RawObservation,
  persistenceErrors: string[]
): boolean {
  try {
    appendRawObservation(root, event)
    return true
  } catch (error) {
    const captured = captureText(error)
    persistenceErrors.push(captured.failureText ?? captured.failureTextCaptureError ?? 'unknown')
    return false
  }
}

function throwObservedFailure(message: string, persistenceErrors: string[]): never {
  const persistence = persistenceErrors.length
    ? `\nPBT observation persistence failed: ${persistenceErrors.join(' | ')}`
    : ''
  throw new Error(`${message}${persistence}`)
}

export function runProperty<T>(
  metadata: PropertyMetadata,
  arb: fc.Arbitrary<T>,
  check: (value: T) => void | boolean,
  options: PropertyOptions = {}
): void {
  const seed = (options.seed ?? PBT_SEED) | 0
  const requestedRuns = options.runs ?? PBT_RUNS
  const observationRoot = options.observationRoot ?? resolveObservationRoot()
  const campaignId = randomUUID()
  const provenance = {
    ...collectObservationProvenance(),
    agent: collectAgentProvenance()
  }
  appendRawObservation(
    observationRoot,
    createEvent(metadata, campaignId, seed, requestedRuns, provenance, {})
  )

  const realRandom = Math.random
  const realNow = Date.now
  Math.random = () => {
    throw new Error(
      `pbt(${metadata.id}): Math.random() is banned inside a property: inject determinism`
    )
  }
  Date.now = () => {
    throw new Error(`pbt(${metadata.id}): Date.now() is banned inside a property: inject a clock`)
  }

  let details: fc.RunDetails<[T]> | null = null
  let executionError: unknown = null
  try {
    details = fc.check(fc.property(arb, check), { seed, numRuns: requestedRuns })
  } catch (error) {
    executionError = error
  } finally {
    Math.random = realRandom
    Date.now = realNow
  }

  if (executionError !== null || details === null) {
    const persistenceErrors: string[] = []
    const capturedFailure = captureText(executionError)
    appendObservedEvent(
      observationRoot,
      createEvent(metadata, campaignId, seed, requestedRuns, provenance, {
        eventKind: 'campaign-completed',
        ...capturedFailure,
        terminationStatus: 'unknown'
      }),
      persistenceErrors
    )
    throwObservedFailure(
      capturedFailure.failureText ?? 'PBT failure text unavailable',
      persistenceErrors
    )
  }

  if (details.failed) {
    const persistenceErrors: string[] = []
    let counterexample: RawObservation['counterexample'] = null
    let counterexampleHash: string | null = null
    let counterexampleCaptureStatus: RawObservation['counterexampleCaptureStatus'] = 'absent'
    let counterexampleCaptureError: string | null = null
    if (details.counterexample !== null) {
      try {
        const taggedCounterexample = toTaggedValue(details.counterexample)
        const taggedCounterexampleHash = hashTaggedValue(taggedCounterexample)
        counterexample = taggedCounterexample
        counterexampleHash = taggedCounterexampleHash
        counterexampleCaptureStatus = 'captured'
      } catch (error) {
        const captured = captureText(error)
        counterexampleCaptureStatus = 'failed'
        counterexampleCaptureError = captured.failureText ?? captured.failureTextCaptureError
      }
    }
    const capturedFailure = captureRunFailure(details)
    const incidentFingerprint =
      counterexampleCaptureStatus === 'captured'
        ? createIncidentFingerprint(metadata, counterexampleHash)
        : null
    const generatedCases = details.numRuns + details.numSkips
    const failureEvent = createEvent(metadata, campaignId, details.seed, requestedRuns, provenance, {
      eventKind: 'failure-observed',
      replayPath: details.counterexamplePath,
      executedRuns: details.numRuns,
      generatedCases,
      skippedCases: details.numSkips,
      shrinkCount: details.numShrinks,
      counterexample,
      counterexampleHash,
      counterexampleCaptureStatus,
      counterexampleCaptureError,
      incidentFingerprint,
      ...capturedFailure,
      terminationStatus: details.interrupted ? 'interrupted' : 'failed'
    })
    const failureRecorded = appendObservedEvent(observationRoot, failureEvent, persistenceErrors)
    appendObservedEvent(
      observationRoot,
      createEvent(metadata, campaignId, details.seed, requestedRuns, provenance, {
        eventKind: 'campaign-completed',
        replayPath: details.counterexamplePath,
        executedRuns: details.numRuns,
        generatedCases,
        skippedCases: details.numSkips,
        shrinkCount: details.numShrinks,
        ...capturedFailure,
        terminationStatus: details.interrupted ? 'interrupted' : 'failed',
        summary: {
          requestedRuns,
          executedRuns: details.numRuns,
          generatedCases,
          skippedCases: details.numSkips,
          failureCount: 1
        }
      }),
      persistenceErrors
    )
    throwObservedFailure(
      `pbt(${metadata.id}) failed after ${details.numShrinks} shrinks ` +
        `(seed=${details.seed}, path=${details.counterexamplePath}, event=${failureRecorded ? failureEvent.eventId : 'unwritten'})\n` +
        `counterexample=${JSON.stringify(counterexample)}\n${capturedFailure.failureText ?? 'PBT failure text unavailable'}`,
      persistenceErrors
    )
  }

  const generatedCases = details.numRuns + details.numSkips
  appendRawObservation(
    observationRoot,
    createEvent(metadata, campaignId, details.seed, requestedRuns, provenance, {
      eventKind: 'campaign-completed',
      executedRuns: details.numRuns,
      generatedCases,
      skippedCases: details.numSkips,
      shrinkCount: details.numShrinks,
      terminationStatus: details.interrupted ? 'interrupted' : 'passed',
      summary: {
        requestedRuns,
        executedRuns: details.numRuns,
        generatedCases,
        skippedCases: details.numSkips,
        failureCount: 0
      }
    })
  )
}

export function replayRegression<T>(
  name: string,
  cases: T[],
  check: (value: T) => void | boolean
): void {
  for (const [index, value] of cases.entries()) {
    const result = check(value)
    if (result === false) {
      throw new Error(`pbt-regression(${name}) case ${index} still fails: ${JSON.stringify(value)}`)
    }
  }
}

export { fc }
