import { describe, expect, it } from 'vitest'
import {
  coverageDebt,
  emptyCoverage,
  initState,
  isTransitionable,
  nextDimension,
  reduce,
  selectAction,
  timePressure,
  topicSaturation,
  transitionability,
  type AnswerEvaluation,
  type Coverage,
  type Roadmap,
  type Topic
} from '../../src/main/ai/roadmap'

function cov(overrides: Partial<Coverage> = {}): Coverage {
  return { ...emptyCoverage(), ...overrides }
}

function topic(id: string, over: Partial<Topic> = {}): Topic {
  return {
    id,
    label: over.label ?? id,
    value: over.value ?? 3,
    coverage: over.coverage ?? emptyCoverage(),
    unresolvedQuestions: over.unresolvedQuestions ?? [],
    askedCount: over.askedCount ?? 0
  }
}

function roadmap(...topics: Topic[]): Roadmap {
  return { topics, objectives: [] }
}

const noEval = (topicId: string | null): AnswerEvaluation => ({
  topicId,
  coverageDeltas: {},
  candidateDelta: {},
  newThreads: [],
  resolvedThreadIds: []
})

describe('coverage', () => {
  it('empty coverage is all missing', () => {
    expect(coverageDebt(topic('t'), 'mid')).toBeGreaterThan(0)
  })

  it('fully explored topic has zero debt for mid level', () => {
    const t = topic('t', {
      coverage: cov({
        motivation: 'explored',
        architecture: 'explored',
        tradeoffs: 'explored',
        failures: 'explored',
        ownership: 'explored'
      })
    })
    expect(coverageDebt(t, 'mid')).toBe(0)
    expect(topicSaturation(t, 'mid')).toBe(1)
  })

  it('entry level requires only partial coverage', () => {
    const t = topic('t', {
      coverage: cov({
        motivation: 'partial',
        architecture: 'partial',
        tradeoffs: 'partial',
        failures: 'partial',
        ownership: 'partial'
      })
    })
    expect(coverageDebt(t, 'entry')).toBe(0)
    expect(coverageDebt(t, 'mid')).toBeGreaterThan(0)
  })

  it('nextDimension prefers highest-weight uncovered dimension', () => {
    const t = topic('t')
    expect(nextDimension(t, 'mid')).toBe('architecture')
  })

  it('nextDimension returns null when saturated', () => {
    const t = topic('t', {
      coverage: cov({
        motivation: 'explored',
        architecture: 'explored',
        tradeoffs: 'explored',
        failures: 'explored',
        ownership: 'explored'
      })
    })
    expect(nextDimension(t, 'mid')).toBeNull()
  })
})

describe('transitionability', () => {
  it('low-debt topic is transitionable early', () => {
    const t = topic('t', {
      coverage: cov({
        architecture: 'explored',
        tradeoffs: 'explored',
        failures: 'partial'
      })
    })
    const s = initState(roadmap(t), { candidate: { level: 'entry' } })
    expect(isTransitionable(t, s)).toBe(true)
  })

  it('high-debt topic is not transitionable without time pressure', () => {
    const t = topic('t')
    const s = initState(roadmap(t))
    expect(isTransitionable(t, s)).toBe(false)
  })

  it('time pressure forces transitionability', () => {
    const t = topic('t')
    const s = { ...initState(roadmap(t)), elapsedMs: 28 * 60 * 1000 }
    expect(timePressure(s)).toBeGreaterThanOrEqual(0.85)
    expect(isTransitionable(t, s)).toBe(true)
    expect(transitionability(t, s)).toBeGreaterThan(0.5)
  })
})

describe('policy', () => {
  it('intro phase asks intro', () => {
    const s = initState(roadmap(topic('a')))
    expect(selectAction(s).kind).toBe('ask_intro')
  })

  it('exploration probes the current unsaturated topic', () => {
    const s = { ...initState(roadmap(topic('a'), topic('b'))), phase: 'exploration' as const }
    const action = selectAction(s)
    expect(action.kind).toBe('probe')
    if (action.kind === 'probe') {
      expect(action.topicId).toBe('a')
      expect(action.dimension).toBe('architecture')
    }
  })

  it('transitions when current topic is saturated', () => {
    const done = topic('a', {
      coverage: cov({
        motivation: 'explored',
        architecture: 'explored',
        tradeoffs: 'explored',
        failures: 'explored',
        ownership: 'explored'
      })
    })
    const s = {
      ...initState(roadmap(done, topic('b'))),
      phase: 'exploration' as const,
      currentTopicId: 'a'
    }
    const action = selectAction(s)
    expect(action.kind).toBe('transition')
    if (action.kind === 'transition') expect(action.topicId).toBe('b')
  })

  it('transition uses a callback when an unresolved thread exists', () => {
    const done = topic('a', {
      coverage: cov({
        motivation: 'explored',
        architecture: 'explored',
        tradeoffs: 'explored',
        failures: 'explored',
        ownership: 'explored'
      })
    })
    const s = {
      ...initState(roadmap(done, topic('b'))),
      phase: 'exploration' as const,
      currentTopicId: 'a',
      threads: [{ id: 'th1', topicId: 'b', note: 'scaling story', value: 4 }]
    }
    const action = selectAction(s)
    expect(action.kind).toBe('transition')
    if (action.kind === 'transition') expect(action.callback).toBe(true)
  })

  it('closes when all topics saturated', () => {
    const done = topic('a', {
      coverage: cov({
        motivation: 'explored',
        architecture: 'explored',
        tradeoffs: 'explored',
        failures: 'explored',
        ownership: 'explored'
      })
    })
    const s = {
      ...initState(roadmap(done)),
      phase: 'exploration' as const,
      currentTopicId: 'a'
    }
    expect(selectAction(s).kind).toBe('closing')
  })

  it('closing then done', () => {
    const s = { ...initState(roadmap(topic('a'))), phase: 'closing' as const }
    expect(selectAction(s).kind).toBe('closing')
    expect(selectAction({ ...s, closingAsked: true }).kind).toBe('done')
  })
})

describe('engine reduce', () => {
  it('start sets intro', () => {
    const s = initState(roadmap(topic('a')))
    expect(reduce(s, { type: 'start' }).phase).toBe('intro')
  })

  it('first answer moves intro to exploration', () => {
    const s = initState(roadmap(topic('a')))
    const next = reduce(s, { type: 'answer', elapsedMs: 1000, evaluation: noEval('a') })
    expect(next.phase).toBe('exploration')
    expect(next.turnCount).toBe(1)
  })

  it('answer applies coverage deltas and increments askedCount', () => {
    const s = { ...initState(roadmap(topic('a'))), phase: 'exploration' as const }
    const next = reduce(s, {
      type: 'answer',
      elapsedMs: 2000,
      evaluation: {
        ...noEval('a'),
        coverageDeltas: { architecture: 'explored' }
      }
    })
    const t = next.roadmap.topics[0]
    expect(t.coverage.architecture).toBe('explored')
    expect(t.askedCount).toBe(1)
  })

  it('answer adds and resolves threads', () => {
    const s = {
      ...initState(roadmap(topic('a'))),
      phase: 'exploration' as const,
      threads: [{ id: 'old', topicId: 'a', note: 'x', value: 2 }]
    }
    const next = reduce(s, {
      type: 'answer',
      elapsedMs: 2000,
      evaluation: {
        ...noEval('a'),
        newThreads: [{ id: 'new', topicId: 'a', note: 'y', value: 3 }],
        resolvedThreadIds: ['old']
      }
    })
    expect(next.threads.map((t) => t.id)).toEqual(['new'])
  })

  it('candidate deltas are clamped to 0..1', () => {
    const s = { ...initState(roadmap(topic('a'))), phase: 'exploration' as const }
    const next = reduce(s, {
      type: 'answer',
      elapsedMs: 2000,
      evaluation: { ...noEval('a'), candidateDelta: { demonstratedSkill: 1.7, confidence: -0.5 } }
    })
    expect(next.candidate.demonstratedSkill).toBe(1)
    expect(next.candidate.confidence).toBe(0)
  })

  it('exploration moves to closing when time budget exhausted', () => {
    const s = { ...initState(roadmap(topic('a'))), phase: 'exploration' as const }
    const next = reduce(s, {
      type: 'answer',
      elapsedMs: 30 * 60 * 1000,
      evaluation: noEval('a')
    })
    expect(next.phase).toBe('closing')
  })

  it('closing answer moves to done and marks closingAsked', () => {
    const s = { ...initState(roadmap(topic('a'))), phase: 'closing' as const }
    const next = reduce(s, { type: 'answer', elapsedMs: 31 * 60 * 1000, evaluation: noEval('a') })
    expect(next.phase).toBe('done')
    expect(next.closingAsked).toBe(true)
  })

  it('full interview reaches done through drive loop', () => {
    let s = initState(roadmap(topic('a'), topic('b')), { budgetMs: 60_000, closingReserveMs: 10_000 })
    s = reduce(s, { type: 'start' })
    let guard = 0
    const explored: Coverage = {
      motivation: 'explored',
      architecture: 'explored',
      tradeoffs: 'explored',
      failures: 'explored',
      ownership: 'explored'
    }
    while (s.phase !== 'done' && guard++ < 50) {
      const action = selectAction(s)
      if (action.kind === 'done') break
      const topicId = 'topicId' in action ? action.topicId : s.currentTopicId
      s = reduce(s, {
        type: 'answer',
        elapsedMs: s.elapsedMs + 5000,
        evaluation: { ...noEval(topicId), coverageDeltas: explored }
      })
    }
    expect(s.phase).toBe('done')
    expect(guard).toBeLessThan(50)
  })
})
