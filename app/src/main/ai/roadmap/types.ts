export const COVERAGE_DIMENSIONS = [
  'motivation',
  'architecture',
  'tradeoffs',
  'failures',
  'ownership'
] as const

export type CoverageDimension = (typeof COVERAGE_DIMENSIONS)[number]

export const COVERAGE_STATUSES = ['missing', 'partial', 'explored'] as const
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number]

export type Coverage = Record<CoverageDimension, CoverageStatus>

export type ExperienceLevel = 'entry' | 'mid' | 'senior'

export interface CandidateState {
  level: ExperienceLevel
  demonstratedSkill: number
  confidence: number
}

export interface Thread {
  id: string
  topicId: string
  note: string
  value: number
}

export interface Topic {
  id: string
  label: string
  value: number
  coverage: Coverage
  unresolvedQuestions: string[]
  askedCount: number
}

export interface Roadmap {
  topics: Topic[]
  objectives: string[]
}

export type Phase = 'intro' | 'exploration' | 'closing' | 'done'

export interface InterviewState {
  phase: Phase
  roadmap: Roadmap
  candidate: CandidateState
  currentTopicId: string | null
  threads: Thread[]
  elapsedMs: number
  budgetMs: number
  closingReserveMs: number
  turnCount: number
  closingAsked: boolean
}

export interface AnswerEvaluation {
  topicId: string | null
  coverageDeltas: Partial<Coverage>
  candidateDelta: Partial<CandidateState>
  newThreads: Thread[]
  resolvedThreadIds: string[]
}

export type InterviewEvent =
  | { type: 'start' }
  | { type: 'answer'; elapsedMs: number; evaluation: AnswerEvaluation }

export type InterviewAction =
  | { kind: 'ask_intro' }
  | { kind: 'probe'; topicId: string; dimension: CoverageDimension; reason: string }
  | { kind: 'transition'; topicId: string; callback: boolean; reason: string }
  | { kind: 'closing' }
  | { kind: 'done' }

export const DEFAULT_BUDGET_MS = 30 * 60 * 1000
export const DEFAULT_CLOSING_RESERVE_MS = 3 * 60 * 1000

export function emptyCoverage(): Coverage {
  return {
    motivation: 'missing',
    architecture: 'missing',
    tradeoffs: 'missing',
    failures: 'missing',
    ownership: 'missing'
  }
}
