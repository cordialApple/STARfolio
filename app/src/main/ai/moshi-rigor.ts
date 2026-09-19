import { MODELS } from './models'
import { evaluateAnswer, type EvaluatorInput } from './roles'
import { stubEnabled, type RoleOptions } from './roles/parse'
import {
  COVERAGE_DIMENSIONS,
  emptyCoverage,
  type AnswerEvaluation,
  type Coverage,
  type CoverageDimension,
  type CoverageStatus
} from './roadmap'
import { evaluatorInputFrom } from './roles/scorer-input'
import { CanonicalTranscript, type EntryInput, type TranscriptEntry } from './transcript'
import type { MoshiInterviewSnapshot } from './moshi-interview'

export interface MoshiRigorCase {
  context: Omit<EvaluatorInput, 'answer'>
  segments: EntryInput[]
  gaps?: EntryInput[][]
}

export interface MoshiRigorResult {
  mode: 'stub' | 'live'
  sourceSessionId?: string
  sourceMode?: MoshiInterviewSnapshot['mode']
  evaluatorModel?: string
  sourceModels?: MoshiInterviewSnapshot['models']
  verdict: 'fixture-only' | 'review-required' | 'no-go'
  agreement: number
  rows: Array<{
    answer: string
    context: Omit<EvaluatorInput, 'answer'>
    segments: TranscriptEntry[]
    cascadeEvaluation: AnswerEvaluation
    gapEvaluations: AnswerEvaluation[]
    dimensions: Record<
      CoverageDimension,
      { cascade: CoverageStatus; gap: CoverageStatus; agrees: boolean }
    >
  }>
}

function buildTranscript(entries: EntryInput[]): CanonicalTranscript {
  const transcript = new CanonicalTranscript()
  for (const entry of entries) transcript.append(entry)
  return transcript
}

function boundEvaluation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = (): void => {
      finish()
      reject(new Error('interview cancelled'))
    }
    const timer = setTimeout(() => {
      finish()
      reject(new Error('Interview role timed out'))
    }, 90_000)
    function finish(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
    }
    signal.addEventListener('abort', cancel, { once: true })
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
    if (signal.aborted) cancel()
  })
}

export async function compareMoshiRigor(
  cases: MoshiRigorCase[],
  options: RoleOptions = {},
  signal: AbortSignal = new AbortController().signal
): Promise<MoshiRigorResult> {
  if (
    !cases.length ||
    cases.reduce((sum, item) => sum + (item.gaps?.length ?? item.segments.length) + 1, 0) > 64
  )
    throw new Error('Rigor replay requires 1 to 64 evaluator calls')
  const result: MoshiRigorResult = {
    mode: stubEnabled(options.stub) ? 'stub' : 'live',
    evaluatorModel: options.model ?? MODELS.evaluator,
    verdict: 'review-required',
    agreement: 0,
    rows: []
  }
  let agreed = 0
  for (const item of cases) {
    if (signal.aborted) throw new Error('interview cancelled')
    const transcript = buildTranscript(item.segments)
    const input = evaluatorInputFrom(transcript, item.context)
    if (!input.answer.trim()) throw new Error('Rigor replay requires candidate answers')
    const cascadeEvaluation = await boundEvaluation(evaluateAnswer(input, options), signal)
    const gapEvaluations: AnswerEvaluation[] = []
    let gap: Coverage = emptyCoverage()
    const gaps =
      item.gaps ??
      transcript
        .all()
        .filter((part) => part.speaker === 'candidate' && part.text)
        .map((part) => [part])
    for (const entries of gaps) {
      if (signal.aborted) throw new Error('interview cancelled')
      const gapTranscript = buildTranscript(entries)
      const gapInput = evaluatorInputFrom(gapTranscript, {
        ...item.context,
        turn: item.context.turn + gapEvaluations.length
      })
      const evaluation = await boundEvaluation(evaluateAnswer(gapInput, options), signal)
      gapEvaluations.push(evaluation)
      gap = { ...gap, ...evaluation.coverageDeltas }
    }
    const cascade = { ...emptyCoverage(), ...cascadeEvaluation.coverageDeltas }
    const dimensions = Object.fromEntries(
      COVERAGE_DIMENSIONS.map((dimension) => {
        const agrees = cascade[dimension] === gap[dimension]
        if (agrees) agreed++
        return [dimension, { cascade: cascade[dimension], gap: gap[dimension], agrees }]
      })
    ) as MoshiRigorResult['rows'][number]['dimensions']
    result.rows.push({
      answer: input.answer,
      context: item.context,
      segments: [...transcript.all()],
      cascadeEvaluation,
      gapEvaluations,
      dimensions
    })
  }
  result.agreement = agreed / (cases.length * COVERAGE_DIMENSIONS.length)
  if (result.mode === 'stub') result.verdict = 'fixture-only'
  else if (result.agreement !== 1) result.verdict = 'no-go'
  return result
}

export async function compareMoshiSessionRigor(
  snapshot: MoshiInterviewSnapshot,
  options: RoleOptions = {},
  signal?: AbortSignal
): Promise<MoshiRigorResult> {
  const cases: MoshiRigorCase[] = []
  for (const audit of snapshot.evaluations) {
    const { answer: _answer, ...context } = audit.input
    const previous = cases.at(-1)
    if (
      previous &&
      previous.context.topicId === context.topicId &&
      previous.context.question === context.question
    ) {
      previous.segments.push(...audit.segments)
      previous.gaps!.push(audit.segments)
    } else {
      cases.push({ context, segments: [...audit.segments], gaps: [audit.segments] })
    }
  }
  const result = await compareMoshiRigor(cases, options, signal)
  if (snapshot.transcriptIntegrity === 'incomplete' || snapshot.unattributed?.length)
    result.verdict = 'no-go'
  return {
    ...result,
    sourceSessionId: snapshot.id,
    sourceMode: snapshot.mode,
    sourceModels: snapshot.models
  }
}
