import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRoadmap,
  planToRoadmap,
  type ArchitectPlan
} from '../../src/main/ai/roles/architect'
import {
  evaluateAnswer,
  outToEvaluation,
  type EvaluatorInput,
  type EvaluatorOut
} from '../../src/main/ai/roles/evaluator'
import { composeUtterance } from '../../src/main/ai/roles/conversation'
import type { InterviewAction } from '../../src/main/ai/roadmap'

beforeEach(() => vi.stubEnv('STARFOLIO_AI_STUB', '1'))
afterEach(() => vi.unstubAllEnvs())

describe('architect', () => {
  it('planToRoadmap seeds coverage and carries objectives', () => {
    const plan: ArchitectPlan = {
      topics: [
        { id: 'pay', label: 'Payments rewrite', value: 5, seed_coverage: ['architecture'], open_threads: ['why Kafka'] }
      ],
      objectives: ['assess system design']
    }
    const rm = planToRoadmap(plan)
    expect(rm.topics[0].coverage.architecture).toBe('partial')
    expect(rm.topics[0].coverage.failures).toBe('missing')
    expect(rm.topics[0].unresolvedQuestions).toEqual(['why Kafka'])
    expect(rm.objectives).toEqual(['assess system design'])
  })

  it('stub builds one topic per experience, descending value', async () => {
    const rm = await buildRoadmap({
      resumeText: 'ignored',
      experiences: [
        { id: 'a', title: 'Search infra' },
        { id: 'b', title: 'Billing', summary: 'led migration' }
      ]
    })
    expect(rm.topics.map((t) => t.id)).toEqual(['a', 'b'])
    expect(rm.topics[0].value).toBeGreaterThan(rm.topics[1].value)
    expect(rm.topics[1].unresolvedQuestions.length).toBe(1)
    expect(rm.objectives.length).toBeGreaterThan(0)
  })

  it('stub derives topics from resume text when no experiences', async () => {
    const rm = await buildRoadmap({ resumeText: 'Built a search engine\nScaled the API\nOwned billing' })
    expect(rm.topics.length).toBeGreaterThan(0)
    expect(rm.topics[0].label).toContain('search')
  })

  it('stub always yields at least one topic for empty input', async () => {
    const rm = await buildRoadmap({ resumeText: '' })
    expect(rm.topics.length).toBe(1)
  })
})

describe('evaluator', () => {
  const base: EvaluatorInput = {
    topicId: 'pay',
    topicLabel: 'Payments',
    question: 'Tell me about it',
    answer: '',
    level: 'mid',
    turn: 2
  }

  it('outToEvaluation maps updates and generates deterministic thread ids', () => {
    const out: EvaluatorOut = {
      coverage_updates: [{ dimension: 'architecture', status: 'explored' }],
      demonstrated_skill: 0.7,
      confidence: 0.6,
      new_threads: [{ note: 'scaling', value: 4 }],
      resolved_thread_ids: ['old'],
      notes: 'ok'
    }
    const evaln = outToEvaluation(out, base)
    expect(evaln.topicId).toBe('pay')
    expect(evaln.coverageDeltas.architecture).toBe('explored')
    expect(evaln.candidateDelta).toEqual({ demonstratedSkill: 0.7, confidence: 0.6 })
    expect(evaln.newThreads[0].id).toBe('pay-t2-0')
    expect(evaln.resolvedThreadIds).toEqual(['old'])
  })

  it('stub infers coverage from keyword cues in a detailed answer', async () => {
    const answer =
      'I designed the system because we needed lower latency, so I architected a new pipeline. ' +
      'I chose Kafka instead of SQS after weighing the tradeoffs, and I owned the rollout end to end ' +
      'even after an outage forced a rollback that I led the fix on with the team over several days.'
    const evaln = await evaluateAnswer({ ...base, answer })
    expect(evaln.coverageDeltas.architecture).toBe('explored')
    expect(evaln.coverageDeltas.tradeoffs).toBe('explored')
    expect(evaln.coverageDeltas.failures).toBe('explored')
    expect(evaln.candidateDelta.demonstratedSkill).toBeGreaterThan(0)
  })

  it('stub marks a thin answer partial and opens a follow-up thread', async () => {
    const evaln = await evaluateAnswer({ ...base, answer: 'I built the API design.' })
    expect(evaln.coverageDeltas.architecture).toBe('partial')
    expect(evaln.newThreads.length).toBe(1)
    expect(evaln.newThreads[0].id).toBe('pay-t2-0')
  })

  it('rejects an empty answer', async () => {
    await expect(evaluateAnswer({ ...base, answer: '   ' })).rejects.toThrow()
  })
})

describe('conversation', () => {
  const cases: Array<{ action: InterviewAction; needle: string }> = [
    { action: { kind: 'ask_intro' }, needle: 'yourself' },
    { action: { kind: 'probe', topicId: 'p', dimension: 'tradeoffs', reason: 'x' }, needle: 'tradeoffs' },
    { action: { kind: 'closing' }, needle: 'time' },
    { action: { kind: 'done' }, needle: 'Thanks' }
  ]

  for (const c of cases) {
    it(`stub renders ${c.action.kind}`, async () => {
      const text = await composeUtterance({ action: c.action, topicLabel: 'Payments' })
      expect(text.length).toBeGreaterThan(0)
      expect(text).toContain(c.needle)
    })
  }

  it('transition with callback bridges from the earlier thread', async () => {
    const text = await composeUtterance({
      action: { kind: 'transition', topicId: 'p', callback: true, reason: 'x' },
      topicLabel: 'Billing',
      callbackNote: 'the migration'
    })
    expect(text).toContain('Earlier you mentioned')
    expect(text).toContain('the migration')
  })
})
