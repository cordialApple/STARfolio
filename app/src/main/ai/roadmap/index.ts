import {
  DEFAULT_BUDGET_MS,
  DEFAULT_CLOSING_RESERVE_MS,
  type CandidateState,
  type InterviewState,
  type Roadmap
} from './types'

export * from './types'
export * from './coverage'
export * from './policy'
export * from './engine'

export interface InitOptions {
  budgetMs?: number
  closingReserveMs?: number
  candidate?: Partial<CandidateState>
}

export function initState(roadmap: Roadmap, opts: InitOptions = {}): InterviewState {
  return {
    phase: 'intro',
    roadmap,
    candidate: {
      level: opts.candidate?.level ?? 'mid',
      demonstratedSkill: opts.candidate?.demonstratedSkill ?? 0.3,
      confidence: opts.candidate?.confidence ?? 0.5
    },
    currentTopicId: roadmap.topics[0]?.id ?? null,
    threads: [],
    elapsedMs: 0,
    budgetMs: opts.budgetMs ?? DEFAULT_BUDGET_MS,
    closingReserveMs: opts.closingReserveMs ?? DEFAULT_CLOSING_RESERVE_MS,
    turnCount: 0,
    closingAsked: false
  }
}
