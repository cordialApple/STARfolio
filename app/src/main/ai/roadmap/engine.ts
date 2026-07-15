import { timePressure, topicSaturation } from './coverage'
import {
  COVERAGE_DIMENSIONS,
  type AnswerEvaluation,
  type CandidateState,
  type Coverage,
  type InterviewEvent,
  type InterviewState,
  type Topic
} from './types'

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function mergeCoverage(base: Coverage, deltas: Partial<Coverage>): Coverage {
  const next = { ...base }
  for (const dim of COVERAGE_DIMENSIONS) {
    const d = deltas[dim]
    if (d) next[dim] = d
  }
  return next
}

function mergeCandidate(
  base: CandidateState,
  delta: Partial<CandidateState>
): CandidateState {
  return {
    level: delta.level ?? base.level,
    demonstratedSkill:
      delta.demonstratedSkill === undefined
        ? base.demonstratedSkill
        : clamp01(delta.demonstratedSkill),
    confidence:
      delta.confidence === undefined
        ? base.confidence
        : clamp01(delta.confidence)
  }
}

function applyEvaluation(state: InterviewState, evaluation: AnswerEvaluation): InterviewState {
  const topics = state.roadmap.topics.map((t): Topic => {
    if (t.id !== evaluation.topicId) return t
    return {
      ...t,
      coverage: mergeCoverage(t.coverage, evaluation.coverageDeltas),
      askedCount: t.askedCount + 1
    }
  })

  const resolved = new Set(evaluation.resolvedThreadIds)
  const threads = state.threads
    .filter((t) => !resolved.has(t.id))
    .concat(evaluation.newThreads)

  return {
    ...state,
    roadmap: { ...state.roadmap, topics },
    candidate: mergeCandidate(state.candidate, evaluation.candidateDelta),
    threads,
    currentTopicId: evaluation.topicId ?? state.currentTopicId
  }
}

function allTopicsSaturated(state: InterviewState): boolean {
  return state.roadmap.topics.every(
    (t) => topicSaturation(t, state.candidate.level) >= 1
  )
}

function nextPhase(state: InterviewState): InterviewState['phase'] {
  if (state.phase === 'intro') return 'exploration'
  if (state.phase === 'exploration') {
    if (timePressure(state) >= 1 || allTopicsSaturated(state)) return 'closing'
    return 'exploration'
  }
  if (state.phase === 'closing') return 'done'
  return state.phase
}

export function reduce(state: InterviewState, event: InterviewEvent): InterviewState {
  switch (event.type) {
    case 'start':
      return { ...state, phase: state.phase === 'done' ? 'done' : 'intro' }

    case 'answer': {
      const withTime: InterviewState = {
        ...state,
        elapsedMs: event.elapsedMs,
        turnCount: state.turnCount + 1
      }
      const evaluated = applyEvaluation(withTime, event.evaluation)
      const phase = nextPhase(evaluated)
      return {
        ...evaluated,
        phase,
        closingAsked: state.phase === 'closing' ? true : evaluated.closingAsked
      }
    }
  }
}
