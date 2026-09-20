import { z } from 'zod'

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
)

const nullableString = z.string().nullable()
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)

export const propertyIdentitySchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    invariant: z.string().min(1)
  })
  .strict()

export const repositoryProvenanceSchema = z
  .object({
    sha: nullableString,
    branch: nullableString,
    worktree: nullableString
  })
  .strict()

export const ciProvenanceSchema = z
  .object({
    provider: nullableString,
    runId: nullableString,
    runAttempt: nullableString,
    workflow: nullableString,
    job: nullableString
  })
  .strict()

export const environmentSchema = z
  .object({
    platform: z.string(),
    arch: z.string(),
    nodeVersion: z.string(),
    ci: z.boolean().nullable()
  })
  .strict()

export const campaignSummarySchema = z
  .object({
    requestedRuns: z.number().int().positive(),
    executedRuns: z.number().int().nonnegative(),
    generatedCases: z.number().int().nonnegative(),
    skippedCases: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((summary, context) => {
    if (summary.executedRuns > summary.requestedRuns) {
      context.addIssue({
        code: 'custom',
        path: ['executedRuns'],
        message: 'Executed runs cannot exceed requested runs'
      })
    }
    if (summary.generatedCases !== summary.executedRuns + summary.skippedCases) {
      context.addIssue({
        code: 'custom',
        path: ['generatedCases'],
        message: 'Generated cases must equal executed plus skipped cases'
      })
    }
  })

export const rawObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().uuid(),
    campaignId: z.string().uuid(),
    eventKind: z.enum(['campaign-started', 'failure-observed', 'campaign-completed']),
    observedAt: z.string().datetime(),
    repository: repositoryProvenanceSchema,
    ci: ciProvenanceSchema,
    property: propertyIdentitySchema,
    harnessVersion: z.string().min(1),
    observationClass: z.enum(['organic', 'mutation', 'sabotage']),
    publicationClass: z.enum(['synthetic', 'restricted', 'unknown']),
    seed: z.number().int(),
    replayPath: nullableString,
    requestedRuns: z.number().int().positive(),
    executedRuns: z.number().int().nonnegative().nullable(),
    generatedCases: z.number().int().nonnegative().nullable(),
    skippedCases: z.number().int().nonnegative().nullable(),
    shrinkCount: z.number().int().nonnegative().nullable(),
    counterexample: jsonValueSchema.nullable(),
    counterexampleHash: sha256.nullable(),
    counterexampleCaptureStatus: z.enum(['captured', 'absent', 'failed']).nullable(),
    counterexampleCaptureError: nullableString,
    incidentFingerprint: sha256.nullable(),
    failureText: nullableString,
    failureTextCaptureStatus: z.enum(['captured', 'failed']).nullable(),
    failureTextCaptureError: nullableString,
    environment: environmentSchema,
    terminationStatus: z.enum(['started', 'passed', 'failed', 'interrupted', 'unknown']),
    summary: campaignSummarySchema.nullable()
  })
  .strict()
  .superRefine((event, context) => {
    const addIssue = (path: string, message: string): void => {
      context.addIssue({ code: 'custom', path: [path], message })
    }
    if (event.executedRuns !== null && event.executedRuns > event.requestedRuns) {
      addIssue('executedRuns', 'Executed runs cannot exceed requested runs')
    }
    if (
      event.executedRuns !== null &&
      event.generatedCases !== null &&
      event.skippedCases !== null &&
      event.generatedCases !== event.executedRuns + event.skippedCases
    ) {
      addIssue('generatedCases', 'Generated cases must equal executed plus skipped cases')
    }
    if (event.counterexampleCaptureStatus === null) {
      for (const field of [
        'counterexample',
        'counterexampleHash',
        'counterexampleCaptureError',
        'incidentFingerprint'
      ] as const) {
        if (event[field] !== null)
          addIssue(field, `${field} requires a counterexample capture status`)
      }
    } else if (event.counterexampleCaptureStatus === 'captured') {
      if (event.counterexample === null)
        addIssue('counterexample', 'Captured counterexample is required')
      if (event.counterexampleHash === null)
        addIssue('counterexampleHash', 'Captured counterexample hash is required')
      if (event.counterexampleCaptureError !== null)
        addIssue('counterexampleCaptureError', 'Captured counterexample error must be null')
      if (event.incidentFingerprint === null)
        addIssue('incidentFingerprint', 'Captured counterexample fingerprint is required')
    } else {
      for (const field of [
        'counterexample',
        'counterexampleHash',
        'incidentFingerprint'
      ] as const) {
        if (event[field] !== null)
          addIssue(
            field,
            `${event.counterexampleCaptureStatus} counterexample ${field} must be null`
          )
      }
      if (
        event.counterexampleCaptureStatus === 'absent' &&
        event.counterexampleCaptureError !== null
      ) {
        addIssue('counterexampleCaptureError', 'Absent counterexample error must be null')
      }
      if (
        event.counterexampleCaptureStatus === 'failed' &&
        event.counterexampleCaptureError === null
      ) {
        addIssue('counterexampleCaptureError', 'Failed counterexample capture error is required')
      }
    }
    if (event.failureTextCaptureStatus === null) {
      if (event.failureText !== null)
        addIssue('failureText', 'Failure text requires a capture status')
      if (event.failureTextCaptureError !== null)
        addIssue('failureTextCaptureError', 'Failure text capture error requires a status')
    } else if (event.failureTextCaptureStatus === 'captured') {
      if (event.failureText === null) addIssue('failureText', 'Captured failure text is required')
      if (event.failureTextCaptureError !== null)
        addIssue('failureTextCaptureError', 'Captured failure text error must be null')
    } else {
      if (event.failureText !== null) addIssue('failureText', 'Failed failure text must be null')
      if (event.failureTextCaptureError === null)
        addIssue('failureTextCaptureError', 'Failed failure text capture error is required')
    }
    if (event.eventKind === 'campaign-started') {
      if (event.terminationStatus !== 'started')
        addIssue('terminationStatus', 'Campaign start must be started')
      for (const field of [
        'replayPath',
        'executedRuns',
        'generatedCases',
        'skippedCases',
        'shrinkCount',
        'counterexample',
        'counterexampleHash',
        'counterexampleCaptureStatus',
        'counterexampleCaptureError',
        'incidentFingerprint',
        'failureText',
        'failureTextCaptureStatus',
        'failureTextCaptureError',
        'summary'
      ] as const) {
        if (event[field] !== null) addIssue(field, `Campaign start ${field} must be null`)
      }
      return
    }
    if (event.eventKind === 'failure-observed') {
      if (event.executedRuns === null)
        addIssue('executedRuns', 'Failure executed runs are required')
      if (event.generatedCases === null)
        addIssue('generatedCases', 'Failure generated cases are required')
      if (event.skippedCases === null)
        addIssue('skippedCases', 'Failure skipped cases are required')
      if (event.shrinkCount === null) addIssue('shrinkCount', 'Failure shrink count is required')
      if (event.counterexampleCaptureStatus === null)
        addIssue('counterexampleCaptureStatus', 'Failure counterexample capture status is required')
      if (event.failureTextCaptureStatus === null)
        addIssue('failureTextCaptureStatus', 'Failure text capture status is required')
      if (!['failed', 'interrupted'].includes(event.terminationStatus)) {
        addIssue('terminationStatus', 'Failure termination must be failed or interrupted')
      }
      if (event.summary !== null) addIssue('summary', 'Failure summary must be null')
      return
    }
    if (event.terminationStatus === 'started') {
      addIssue('terminationStatus', 'Campaign completion cannot be started')
    }
    for (const field of [
      'counterexample',
      'counterexampleHash',
      'counterexampleCaptureStatus',
      'counterexampleCaptureError',
      'incidentFingerprint'
    ] as const) {
      if (event[field] !== null) addIssue(field, `Campaign completion ${field} must be null`)
    }
    if (event.terminationStatus === 'passed') {
      if (event.executedRuns !== event.requestedRuns)
        addIssue('executedRuns', 'Passed campaign must execute every requested run')
      for (const field of [
        'failureText',
        'failureTextCaptureStatus',
        'failureTextCaptureError'
      ] as const) {
        if (event[field] !== null) addIssue(field, `Passed campaign ${field} must be null`)
      }
    }
    if (event.terminationStatus === 'failed' && event.failureTextCaptureStatus === null) {
      addIssue(
        'failureTextCaptureStatus',
        'Failed campaign failure text capture status is required'
      )
    }
    if (event.terminationStatus === 'passed' && event.summary?.failureCount !== 0) {
      addIssue('summary', 'Passed campaign failure count must be zero')
    }
    if (event.terminationStatus === 'failed' && event.summary?.failureCount === 0) {
      addIssue('summary', 'Failed campaign failure count must be positive')
    }
    if (event.terminationStatus !== 'unknown') {
      if (event.executedRuns === null)
        addIssue('executedRuns', 'Campaign completion executed runs are required')
      if (event.generatedCases === null)
        addIssue('generatedCases', 'Campaign completion generated cases are required')
      if (event.skippedCases === null)
        addIssue('skippedCases', 'Campaign completion skipped cases are required')
      if (event.summary === null) addIssue('summary', 'Campaign completion summary is required')
    }
    if (
      event.summary &&
      (event.summary.requestedRuns !== event.requestedRuns ||
        event.summary.executedRuns !== event.executedRuns ||
        event.summary.generatedCases !== event.generatedCases ||
        event.summary.skippedCases !== event.skippedCases)
    ) {
      addIssue('summary', 'Campaign summary run counts must match the event')
    }
  })

export const dispositionSchema = z.enum([
  'confirmed-code-bug',
  'oracle-bug',
  'generator-bug',
  'duplicate',
  'flake',
  'expected-sabotage',
  'unresolved'
])

const annotationBase = {
  schemaVersion: z.literal(1),
  annotationId: z.string().uuid(),
  targetEventId: z.string().uuid(),
  recordedAt: z.string().datetime(),
  author: z
    .object({
      kind: z.enum(['human', 'agent', 'ci', 'unknown']),
      id: nullableString
    })
    .strict(),
  publicationClass: z.enum(['synthetic', 'restricted', 'unknown']),
  note: nullableString
}

const evidenceSchema = z
  .object({
    kind: z.enum(['review', 'adjudication']),
    url: z.string().url()
  })
  .strict()

const dispositionAnnotationSchema = z
  .object({
    ...annotationBase,
    annotationKind: z.literal('disposition'),
    disposition: dispositionSchema,
    duplicateOfEventId: z.string().uuid().nullable(),
    evidence: evidenceSchema.nullable()
  })
  .strict()
  .superRefine((annotation, context) => {
    if (annotation.disposition === 'duplicate' && annotation.duplicateOfEventId === null) {
      context.addIssue({
        code: 'custom',
        path: ['duplicateOfEventId'],
        message: 'Duplicate target is required'
      })
    }
    if (annotation.disposition !== 'duplicate' && annotation.duplicateOfEventId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['duplicateOfEventId'],
        message: 'Duplicate target is only valid for duplicate disposition'
      })
    }
    if (annotation.disposition === 'confirmed-code-bug' && annotation.evidence === null) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'Confirmed defects require review or adjudication evidence'
      })
    }
  })

export const annotationSchema = z
  .union([
    z
      .object({
        ...annotationBase,
        annotationKind: z.literal('correction'),
        correction: z.record(z.string(), jsonValueSchema)
      })
      .strict(),
    z
      .object({
        ...annotationBase,
        annotationKind: z.literal('classification'),
        classification: z.string().min(1),
        evidence: evidenceSchema.nullable()
      })
      .strict(),
    z
      .object({
        ...annotationBase,
        annotationKind: z.literal('duplicate-link'),
        duplicateOfEventId: z.string().uuid()
      })
      .strict(),
    dispositionAnnotationSchema
  ])
  .superRefine((annotation, context) => {
    if (
      annotation.annotationKind === 'classification' &&
      /(?:^|[^a-z])confirmed(?:[^a-z]|$)/i.test(annotation.classification) &&
      annotation.evidence === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'Confirmed classifications require review or adjudication evidence'
      })
    }
    if (
      'duplicateOfEventId' in annotation &&
      annotation.duplicateOfEventId === annotation.targetEventId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['duplicateOfEventId'],
        message: 'An event cannot duplicate itself'
      })
    }
  })

export type PropertyIdentity = z.infer<typeof propertyIdentitySchema>
export type RawObservation = z.infer<typeof rawObservationSchema>
export type ObservationAnnotation = z.infer<typeof annotationSchema>
export type ObservationClass = RawObservation['observationClass']
export type PublicationClass = RawObservation['publicationClass']
