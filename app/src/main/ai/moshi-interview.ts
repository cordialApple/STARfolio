import { randomUUID } from 'crypto'
import { MODELS } from './models'
import {
  verifyMoshiRealization,
  type MoshiRealization,
  type MoshiIntentContext
} from './mouth/moshi-realization'
import {
  buildRoadmap,
  evaluateAnswer,
  summarizeInterview,
  type EvaluatorInput,
  type InterviewReport
} from './roles'
import { stubEnabled } from './roles/parse'
import {
  directAction,
  initState,
  reduce,
  type AnswerEvaluation,
  type DirectedAction,
  type InterviewState,
  type Roadmap
} from './roadmap'
import { CanonicalTranscript, type EntryInput, type TranscriptEntry } from './transcript'
import { evaluatorInputFrom } from './roles/scorer-input'
import type { InterviewRuntime, StartInterviewInput } from './session'
import { saveMoshiInterview } from '../db/repositories/moshi-interview'

export interface MoshiConditioning {
  revision: number
  roadmap: Roadmap
  action: DirectedAction
}

export interface MoshiEvaluation {
  input: EvaluatorInput
  segments: TranscriptEntry[]
  evaluation: AnswerEvaluation
  truncated: boolean
  overlap: boolean
  topicAttribution: 'observed-question'
  scoredAtMs: number
}

export interface MoshiInterviewSnapshot {
  id: string
  candidateName: string | null
  startedAtMs: number
  status: 'active' | 'finishing' | 'finished' | 'cancelled' | 'failed'
  mode: 'stub' | 'live' | 'mixed'
  models?: { architect: string; evaluator: string; summary: string; evaluatorUsageId?: string }
  state: InterviewState
  transcript: TranscriptEntry[]
  evaluations: MoshiEvaluation[]
  conditioning: Array<
    MoshiConditioning & {
      delivery: 'requested' | 'received' | 'consumed' | 'rejected'
      reason?: string
    }
  >
  commandConformance: 'unverified'
  realizations?: Array<
    MoshiRealization & {
      revision: number | null
      entries: TranscriptEntry[]
      mode: 'stub' | 'live'
    }
  >
  unattributed?: Array<{ segments: TranscriptEntry[]; reason: string }>
  terminationReason?: string
  transcriptIntegrity?: 'complete' | 'incomplete'
  roleCalls?: number
  report: InterviewReport | null
  error?: string
}

export interface MoshiInterviewPorts {
  onConditioning: (update: MoshiConditioning) => void
  onUpdate?: (snapshot: MoshiInterviewSnapshot) => void
  save?: (snapshot: MoshiInterviewSnapshot) => void
  now?: () => number
  signal?: AbortSignal
  roleTimeoutMs?: number
  maxEvaluations?: number
  evaluate?: typeof evaluateAnswer
  summarize?: typeof summarizeInterview
  verify?: typeof verifyMoshiRealization
}

type ActiveContext = {
  revision: number
  version: number
  action: DirectedAction['intent']
  question: string
  phase: InterviewState['phase']
}
type Batch = {
  transcript: CanonicalTranscript
  observed: TranscriptEntry[]
  requested: MoshiConditioning | null
  context: ActiveContext | null
  version: number
  overlap: boolean
  inherited?: Batch
  resolvedContext?: ActiveContext | null
}

function bounded<T>(work: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancelled = (): void => {
      finish()
      reject(new Error('interview cancelled'))
    }
    const timer = setTimeout(() => {
      finish()
      reject(new Error('Interview role timed out'))
    }, timeoutMs)
    function finish(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancelled)
    }
    signal.addEventListener('abort', cancelled, { once: true })
    work.then(
      (value) => {
        finish()
        resolve(value)
      },
      (error) => {
        finish()
        reject(error)
      }
    )
    if (signal.aborted) cancelled()
  })
}

function roleMode(runtime: InterviewRuntime): MoshiInterviewSnapshot['mode'] {
  const architect = stubEnabled(runtime.architect?.stub)
  const evaluator = stubEnabled(runtime.evaluator?.stub)
  if (architect !== evaluator) return 'mixed'
  return architect ? 'stub' : 'live'
}

function buildTranscript(entries: EntryInput[]): CanonicalTranscript {
  const transcript = new CanonicalTranscript()
  for (const entry of entries) transcript.append(entry)
  return transcript
}

export class MoshiInterview {
  readonly id = randomUUID()
  private readonly transcript = new CanonicalTranscript()
  private readonly controller = new AbortController()
  private readonly now: () => number
  private readonly save: (snapshot: MoshiInterviewSnapshot) => void
  private readonly timeoutMs: number
  private readonly maxEvaluations: number
  private pending: TranscriptEntry[] = []
  private activeContext: ActiveContext | null = null
  private contextVersion = 0
  private pendingBatch: Omit<Batch, 'transcript' | 'overlap'> | null = null
  private consumed = new Map<number, Set<TranscriptEntry>>()
  private questionBoundaryMs = 0
  private batches: Batch[] = []
  private lastBatch: Batch | null = null
  private inFlight: Promise<void> | null = null
  private finishing: Promise<MoshiInterviewSnapshot> | null = null
  private calls = 1
  private data: MoshiInterviewSnapshot

  constructor(
    input: StartInterviewInput,
    roadmap: Roadmap,
    private runtime: InterviewRuntime,
    private ports: MoshiInterviewPorts
  ) {
    this.now = ports.now ?? Date.now
    this.save = ports.save ?? saveMoshiInterview
    this.timeoutMs = ports.roleTimeoutMs ?? 90_000
    this.maxEvaluations = ports.maxEvaluations ?? 60
    this.data = {
      id: this.id,
      candidateName: input.candidateName ?? null,
      startedAtMs: this.now(),
      status: 'active',
      mode: roleMode(runtime),
      models: {
        architect: runtime.architect?.model ?? MODELS.architect,
        evaluator: runtime.evaluator?.model ?? MODELS.evaluator,
        summary: runtime.evaluator?.model ?? MODELS.summary,
        evaluatorUsageId: runtime.evaluator?.usageId
      },
      state: reduce(
        initState(roadmap, {
          budgetMs: input.budgetMs,
          closingReserveMs: input.closingReserveMs,
          candidate: input.level ? { level: input.level } : undefined
        }),
        { type: 'start' }
      ),
      transcript: [],
      evaluations: [],
      conditioning: [],
      commandConformance: 'unverified',
      realizations: [],
      unattributed: [],
      transcriptIntegrity: 'complete',
      report: null
    }
    ports.signal?.addEventListener('abort', () => this.cancel(), { once: true })
  }

  start(): void {
    this.emitConditioning()
  }

  snapshot(): MoshiInterviewSnapshot {
    return structuredClone({
      ...this.data,
      transcript: [...this.transcript.all()],
      roleCalls: this.calls
    })
  }

  private publish(): void {
    const snapshot = this.snapshot()
    this.save(snapshot)
    this.ports.onUpdate?.(snapshot)
  }

  private emitConditioning(): void {
    const update: MoshiConditioning = {
      revision: this.data.conditioning.length + 1,
      roadmap: structuredClone(this.data.state.roadmap),
      action: directAction(this.data.state)
    }
    this.data.conditioning.push({ ...update, delivery: 'requested' })
    this.publish()
    this.ports.onConditioning(structuredClone(update))
  }

  recordConditioningDelivery(
    revision: number,
    delivery: 'received' | 'consumed' | 'rejected',
    reason?: string
  ): void {
    const item = this.data.conditioning.find((entry) => entry.revision === revision)
    if (!item || this.data.status !== 'active') return
    if (item.delivery === 'consumed' && delivery === 'received') return
    if (delivery === 'consumed' && !this.consumed.has(revision))
      this.consumed.set(revision, new Set(this.transcript.all()))
    item.delivery = delivery
    item.reason = reason
    this.publish()
  }

  appendSegment(input: EntryInput): void {
    if (this.data.status !== 'active') throw new Error('This interview has ended')
    if (![input.startMs, input.endMs].every((value) => Number.isFinite(value) && value >= 0))
      throw new Error('Invalid transcript timestamp')
    if (input.text.length > 16_000 || this.transcript.length >= 1_000)
      throw new Error('Interview transcript limit reached')
    if (!input.text.trim()) return
    const entry = this.transcript.append(input)
    if (entry.speaker === 'candidate') {
      if (!this.pendingBatch) {
        const observed = this.transcript
          .all()
          .filter(
            (item) =>
              item.speaker === 'interviewer' &&
              item.endMs > this.questionBoundaryMs &&
              item.startMs <= entry.startMs
          )
        const requested =
          [...this.data.conditioning]
            .reverse()
            .find(
              (item) =>
                item.delivery === 'consumed' &&
                observed.some((itemEntry) => !this.consumed.get(item.revision)?.has(itemEntry))
            ) ?? null
        this.pendingBatch = {
          observed: [...observed],
          requested,
          context: this.activeContext ? structuredClone(this.activeContext) : null,
          version: this.contextVersion,
          inherited: observed.length ? undefined : (this.lastBatch ?? undefined)
        }
      }
      this.pending.push(entry)
    }
    this.publish()
  }

  private enqueue(): void {
    if (!this.pending.length || !this.pendingBatch) return
    const transcript = buildTranscript(this.pending)
    const overlap = this.transcript
      .overlaps()
      .some(([a, b]) => this.pending.includes(a) || this.pending.includes(b))
    const batch: Batch = { ...this.pendingBatch, transcript, overlap }
    this.batches.push(batch)
    this.lastBatch = batch
    this.questionBoundaryMs = Math.max(
      this.questionBoundaryMs,
      ...this.pending.map((entry) => entry.endMs)
    )
    this.pending = []
    this.pendingBatch = null
  }

  private intentContext(action: DirectedAction['intent']): MoshiIntentContext {
    const topicId = action.kind === 'probe' || action.kind === 'transition' ? action.topicId : null
    return {
      action,
      topicLabel: this.data.state.roadmap.topics.find((topic) => topic.id === topicId)?.label
    }
  }

  private runRole<T>(work: () => Promise<T>): Promise<T> {
    if (++this.calls > this.maxEvaluations) throw new Error('Interview role call limit reached')
    return bounded(work(), this.controller.signal, this.timeoutMs)
  }

  private async resolveContext(batch: Batch): Promise<ActiveContext | null> {
    if (!batch.observed.length)
      return batch.inherited && 'resolvedContext' in batch.inherited
        ? (batch.inherited.resolvedContext ?? null)
        : batch.context
    const result = await this.runRole(() =>
      (this.ports.verify ?? verifyMoshiRealization)(
        {
          requested: batch.requested ? this.intentContext(batch.requested.action.intent) : null,
          previous: batch.context ? this.intentContext(batch.context.action) : null,
          entries: batch.observed
        },
        this.runtime.evaluator
      )
    )
    if (this.controller.signal.aborted) return null
    this.data.realizations!.push({
      ...result,
      revision: batch.requested?.revision ?? null,
      entries: batch.observed,
      mode: stubEnabled(this.runtime.evaluator?.stub) ? 'stub' : 'live'
    })
    let context: ActiveContext | null = null
    if (result.binding === 'requested' && batch.requested) {
      const action = batch.requested.action.intent
      const phase =
        action.kind === 'ask_intro'
          ? 'intro'
          : action.kind === 'closing'
            ? 'closing'
            : action.kind === 'done'
              ? 'done'
              : 'exploration'
      context = {
        action,
        revision: batch.requested.revision,
        version: batch.version,
        phase,
        question: batch.observed.map((entry) => entry.text).join(' ')
      }
    } else if (result.binding === 'previous' && batch.context) {
      context = {
        ...batch.context,
        question: result.backchannel
          ? batch.context.question
          : batch.observed.map((entry) => entry.text).join(' ')
      }
    }
    if (batch.version === this.contextVersion) {
      this.contextVersion++
      if (context) context.version = this.contextVersion
      this.activeContext = context
      if (context?.action.kind === 'closing')
        this.data.state = { ...this.data.state, phase: 'closing', closingAsked: true }
      if (context?.action.kind === 'transition')
        this.data.state = { ...this.data.state, currentTopicId: context.action.topicId }
    }
    return context
  }

  gap(): Promise<void> {
    if (this.data.status !== 'active' && this.data.status !== 'finishing') return Promise.resolve()
    this.enqueue()
    if (!this.batches.length && !this.inFlight) return Promise.resolve()
    if (!this.inFlight)
      this.inFlight = this.drain().finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  private async drain(): Promise<void> {
    await Promise.resolve()
    try {
      while (this.batches.length && !this.controller.signal.aborted) {
        const batch = this.batches.shift()!
        const context = await this.resolveContext(batch)
        batch.resolvedContext = context
        if (this.controller.signal.aborted) return
        if (!context) {
          this.data.unattributed!.push({
            segments: [...batch.transcript.all()],
            reason:
              'No verified observed question context; candidate evidence retained without topic scoring'
          })
          this.publish()
          continue
        }
        let evaluation: AnswerEvaluation = {
          topicId: null,
          coverageDeltas: {},
          candidateDelta: {},
          newThreads: [],
          resolvedThreadIds: []
        }
        if (context.action.kind === 'probe' || context.action.kind === 'transition') {
          const topicId = context.action.topicId
          const topic = this.data.state.roadmap.topics.find((item) => item.id === topicId)!
          const input = evaluatorInputFrom(batch.transcript, {
            topicId,
            topicLabel: topic.label,
            question: context.question,
            level: this.data.state.candidate.level,
            turn: this.data.state.turnCount
          })
          evaluation = await this.runRole(() =>
            (this.ports.evaluate ?? evaluateAnswer)(input, this.runtime.evaluator)
          )
          if (this.controller.signal.aborted) return
          this.data.evaluations.push({
            input,
            segments: [...batch.transcript.all()],
            evaluation,
            truncated: batch.transcript.all().some((entry) => entry.truncated),
            overlap: batch.overlap,
            topicAttribution: 'observed-question',
            scoredAtMs: this.now()
          })
        }
        const prior = this.data.state
        const mayAdvance = context.version === this.contextVersion && context.phase === prior.phase
        const updated = reduce(prior, {
          type: 'answer',
          elapsedMs: Math.max(0, this.now() - this.data.startedAtMs),
          evaluation
        })
        this.data.state = mayAdvance
          ? updated
          : {
              ...updated,
              phase: prior.phase,
              currentTopicId: prior.currentTopicId,
              closingAsked: prior.closingAsked
            }
        if (this.data.status === 'active' && mayAdvance) this.emitConditioning()
        else this.publish()
      }
    } catch (error) {
      this.fail(error)
    }
  }

  finish(reason?: string): Promise<MoshiInterviewSnapshot> {
    if (reason) {
      this.data.terminationReason = reason
      if (
        /incomplete|timed? out|timeout|heartbeat|deadline|expired|disconnect|error|fail|closed unexpectedly|window.*(?:closed|reloaded)/i.test(
          reason
        )
      )
        this.data.transcriptIntegrity = 'incomplete'
    }
    if (this.finishing) return this.finishing
    if (this.data.status !== 'active') return Promise.resolve(this.snapshot())
    this.data.status = 'finishing'
    this.finishing = this.complete()
    return this.finishing
  }

  private async complete(): Promise<MoshiInterviewSnapshot> {
    await this.gap()
    if (this.controller.signal.aborted) return this.snapshot()
    try {
      if (this.data.evaluations.length) {
        const report = await this.runRole(() =>
          (this.ports.summarize ?? summarizeInterview)(
            {
              transcript: [...this.transcript.all()],
              roadmap: this.data.state.roadmap,
              candidate: this.data.state.candidate
            },
            this.runtime.evaluator
          )
        )
        if (this.controller.signal.aborted) return this.snapshot()
        this.data.report =
          this.data.transcriptIntegrity === 'incomplete'
            ? {
                ...report,
                overallFeedback: `Transcript incomplete (${this.data.terminationReason ?? 'abnormal termination'}). Coverage and feedback reflect captured evidence only. ${report.overallFeedback}`
              }
            : report
      }
      if (this.controller.signal.aborted) return this.snapshot()
      this.data.status = 'finished'
      this.data.state = { ...this.data.state, phase: 'done' }
      this.publish()
    } catch (error) {
      this.fail(error)
    }
    return this.snapshot()
  }

  private fail(error: unknown): void {
    if (this.controller.signal.aborted) return
    this.data.status = 'failed'
    this.data.error = error instanceof Error ? error.message : String(error)
    this.controller.abort()
    this.publish()
  }

  cancel(): void {
    if (this.data.status === 'finished' || this.data.status === 'cancelled') return
    this.controller.abort()
    this.data.status = 'cancelled'
    this.publish()
  }
}

export async function startMoshiInterview(
  input: StartInterviewInput & { jobDescription?: string },
  runtime: InterviewRuntime = {},
  ports: MoshiInterviewPorts
): Promise<MoshiInterview> {
  if (!input.resumeText.trim()) throw new Error('Resume text is required')
  const signal = ports.signal ?? new AbortController().signal
  if (signal.aborted) throw new Error('interview cancelled')
  const roadmap = await bounded(
    buildRoadmap(
      {
        resumeText: input.resumeText,
        jobDescription: input.jobDescription,
        experiences: input.experiences
      },
      runtime.architect
    ),
    signal,
    ports.roleTimeoutMs ?? 90_000
  )
  if (signal.aborted) throw new Error('interview cancelled')
  const session = new MoshiInterview(input, roadmap, runtime, ports)
  session.start()
  return session
}

export { compareMoshiRigor, compareMoshiSessionRigor } from './moshi-rigor'
export type { MoshiRigorCase, MoshiRigorResult } from './moshi-rigor'
