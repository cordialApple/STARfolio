import {
  COVERAGE_DIMENSIONS,
  type CoverageDimension,
  type CoverageStatus,
  type ExperienceLevel,
  type InterviewState,
  type Topic
} from './types'

const STATUS_WEIGHT: Record<CoverageStatus, number> = {
  missing: 0,
  partial: 0.5,
  explored: 1
}

const DIMENSION_WEIGHT: Record<CoverageDimension, number> = {
  motivation: 0.4,
  architecture: 1,
  tradeoffs: 1,
  failures: 0.9,
  ownership: 0.7
}

const REQUIRED_STATUS: Record<ExperienceLevel, CoverageStatus> = {
  entry: 'partial',
  mid: 'explored',
  senior: 'explored'
}

export function statusWeight(status: CoverageStatus): number {
  return STATUS_WEIGHT[status]
}

export function dimensionWeight(dim: CoverageDimension): number {
  return DIMENSION_WEIGHT[dim]
}

export function requiredStatus(level: ExperienceLevel): CoverageStatus {
  return REQUIRED_STATUS[level]
}

function dimensionGain(
  topic: Topic,
  dim: CoverageDimension,
  required: CoverageStatus
): number {
  const gap = STATUS_WEIGHT[required] - STATUS_WEIGHT[topic.coverage[dim]]
  return gap > 0 ? gap * DIMENSION_WEIGHT[dim] : 0
}

export function coverageDebt(topic: Topic, level: ExperienceLevel): number {
  const required = requiredStatus(level)
  let debt = 0
  for (const dim of COVERAGE_DIMENSIONS) {
    debt += dimensionGain(topic, dim, required)
  }
  return debt
}

export function topicSaturation(topic: Topic, level: ExperienceLevel): number {
  const required = requiredStatus(level)
  let total = 0
  let met = 0
  for (const dim of COVERAGE_DIMENSIONS) {
    const w = DIMENSION_WEIGHT[dim]
    total += w
    met += w * Math.min(STATUS_WEIGHT[topic.coverage[dim]] / STATUS_WEIGHT[required], 1)
  }
  return total === 0 ? 1 : met / total
}

export function nextDimension(
  topic: Topic,
  level: ExperienceLevel
): CoverageDimension | null {
  const required = requiredStatus(level)
  let best: CoverageDimension | null = null
  let bestGain = 0
  for (const dim of COVERAGE_DIMENSIONS) {
    const gain = dimensionGain(topic, dim, required)
    if (gain > bestGain) {
      bestGain = gain
      best = dim
    }
  }
  return best
}

const DEBT_THRESHOLD = 0.6

export function timePressure(state: InterviewState): number {
  const usable = Math.max(state.budgetMs - state.closingReserveMs, 1)
  return Math.min(state.elapsedMs / usable, 1)
}

export function transitionability(topic: Topic, state: InterviewState): number {
  const debt = coverageDebt(topic, state.candidate.level)
  const pressure = timePressure(state)
  const debtScore = Math.max(0, 1 - debt / DEBT_THRESHOLD)
  return Math.min(1, debtScore + pressure * (1 - debtScore))
}

export function isTransitionable(topic: Topic, state: InterviewState): boolean {
  const debt = coverageDebt(topic, state.candidate.level)
  if (debt <= DEBT_THRESHOLD) return true
  return timePressure(state) >= 0.85
}
