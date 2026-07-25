import fc from 'fast-check'
import {
  COVERAGE_DIMENSIONS,
  COVERAGE_STATUSES,
  type CandidateState,
  type Coverage,
  type ExperienceLevel,
  type InterviewState,
  type Phase,
  type Roadmap,
  type Thread,
  type Topic
} from '../types'

const LEVELS: readonly ExperienceLevel[] = ['entry', 'mid', 'senior']
const PHASES: readonly Phase[] = ['intro', 'exploration', 'closing', 'done']

const coverageArb: fc.Arbitrary<Coverage> = fc
  .tuple(...COVERAGE_DIMENSIONS.map(() => fc.constantFrom(...COVERAGE_STATUSES)))
  .map((statuses) => {
    const cov = {} as Coverage
    COVERAGE_DIMENSIONS.forEach((dim, i) => {
      cov[dim] = statuses[i]
    })
    return cov
  })

function topicArb(id: string): fc.Arbitrary<Topic> {
  return fc.record({
    id: fc.constant(id),
    label: fc.constant(id),
    value: fc.integer({ min: 1, max: 5 }),
    coverage: coverageArb,
    unresolvedQuestions: fc.array(fc.string(), { maxLength: 3 }),
    askedCount: fc.integer({ min: 0, max: 6 })
  })
}

const candidateArb: fc.Arbitrary<CandidateState> = fc.record({
  level: fc.constantFrom(...LEVELS),
  demonstratedSkill: fc.double({ min: 0, max: 1, noNaN: true }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true })
})

export const interviewStateArb: fc.Arbitrary<InterviewState> = fc
  .integer({ min: 1, max: 6 })
  .chain((n) => {
    const ids = Array.from({ length: n }, (_, i) => `topic-${i}`)
    const topics = fc.tuple(...ids.map(topicArb))
    const threads = fc.array(
      fc.record({
        id: fc.string({ minLength: 1 }),
        topicId: fc.constantFrom(...ids),
        note: fc.string({ minLength: 1 }),
        value: fc.integer({ min: 1, max: 5 })
      }),
      { maxLength: 4 }
    ) as fc.Arbitrary<Thread[]>
    return fc.record({
      phase: fc.constantFrom(...PHASES),
      roadmap: topics.map((t): Roadmap => ({ topics: t, objectives: [] })),
      candidate: candidateArb,
      currentTopicId: fc.constantFrom(null, ...ids),
      threads,
      elapsedMs: fc.integer({ min: 0, max: 40 * 60 * 1000 }),
      budgetMs: fc.integer({ min: 5 * 60 * 1000, max: 60 * 60 * 1000 }),
      closingReserveMs: fc.integer({ min: 0, max: 5 * 60 * 1000 }),
      turnCount: fc.integer({ min: 0, max: 40 }),
      closingAsked: fc.boolean()
    })
  })

export { fc }
