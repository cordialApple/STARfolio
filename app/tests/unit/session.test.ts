import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startInterview, answerInterview, getInterviewReport } from '../../src/main/ai/session'
import { stubTransport } from '../../src/main/ai/transport'
import { initDb } from '../../src/main/db/client'
import { loadSession } from '../../src/main/db/repositories/interview'

beforeEach(() => {
  vi.stubEnv('STARFOLIO_AI_STUB', '1')
  initDb(':memory:')
})
afterEach(() => vi.unstubAllEnvs())

const detailed =
  'I designed the ingestion system because we needed lower latency, so I architected a new pipeline. ' +
  'I chose Kafka instead of SQS after weighing the tradeoffs, and I owned the rollout end to end even ' +
  'after an outage forced a rollback that I led the fix on with the team over several days of on-call.'

async function runToDone() {
  const utterances: string[] = []
  let step = await startInterview({
    resumeText: 'ignored',
    experiences: [{ id: 'a', title: 'Ingestion pipeline', summary: 'led the migration' }],
    budgetMs: 1000,
    closingReserveMs: 500
  })
  utterances.push(step.utterance)

  for (let i = 0; i < 5 && !step.done; i++) {
    step = await answerInterview({
      sessionId: step.sessionId,
      answer: detailed,
      elapsedMs: i === 0 ? 0 : 1000
    })
    utterances.push(step.utterance)
  }
  return { step, utterances }
}

describe('interview session', () => {
  it('uses resume and JD context in a text interview roadmap and question', async () => {
    vi.stubEnv('STARFOLIO_AI_STUB', '0')
    const parse = vi.fn(async () => ({
      stop_reason: 'end_turn',
      parsed_output: {
        topics: [
          {
            id: 'checkout',
            label: 'Checkout',
            value: 5,
            seed_coverage: [],
            open_threads: [],
            candidate_evidence: 'built checkout services',
            role_requirements: ['Kubernetes operations']
          }
        ],
        objectives: []
      },
      usage: { input_tokens: 1, output_tokens: 1 }
    }))
    const runtime = {
      architect: { provider: { parse }, model: 'architect-test' },
      conversation: { transport: stubTransport() }
    }
    const first = await startInterview(
      {
        resumeText: 'I built checkout services in Go.',
        jobDescription: 'Own Kubernetes operations.'
      },
      runtime
    )
    expect(parse.mock.calls[0][0].userText).toContain('<<<JOB_DESCRIPTION')
    expect(loadSession(first.sessionId)?.state.roadmap.topics[0].roleRequirements).toEqual([
      'Kubernetes operations'
    ])
    const next = await answerInterview(
      { sessionId: first.sessionId, answer: 'I built the checkout API.' },
      runtime
    )
    expect(next.utterance).toContain('built checkout services')
    expect(next.utterance).toContain('Kubernetes operations')
  })

  it('opens with an intro question', async () => {
    const step = await startInterview({
      resumeText: 'ignored',
      experiences: [{ id: 'a', title: 'Ingestion pipeline' }]
    })
    expect(step.phase).toBe('intro')
    expect(step.done).toBe(false)
    expect(step.utterance).toContain('yourself')
    expect(step.report).toBeNull()
  })

  it('drives a full interview to done and produces a report', async () => {
    const { step, utterances } = await runToDone()
    expect(step.done).toBe(true)
    expect(step.phase).toBe('done')

    const closings = utterances.filter((u) => u.includes('coming up on time'))
    expect(closings.length).toBe(1)

    const report = step.report
    expect(report).not.toBeNull()
    expect(report!.overallFeedback.length).toBeGreaterThan(0)
    expect(Array.isArray(report!.improvementAreas)).toBe(true)
    expect(report!.starStories.length).toBeGreaterThan(0)

    expect(getInterviewReport(step.sessionId)).toEqual(report)
  })

  it('rejects an unknown session', async () => {
    await expect(answerInterview({ sessionId: 'nope', answer: 'hi' })).rejects.toThrow('not found')
    expect(() => getInterviewReport('nope')).toThrow('not found')
  })

  it('rejects answering after the interview has ended', async () => {
    const { step } = await runToDone()
    await expect(answerInterview({ sessionId: step.sessionId, answer: detailed })).rejects.toThrow('ended')
  })

  it('rejects an empty answer', async () => {
    const step = await startInterview({
      resumeText: 'ignored',
      experiences: [{ id: 'a', title: 'Ingestion pipeline' }]
    })
    await expect(answerInterview({ sessionId: step.sessionId, answer: '   ' })).rejects.toThrow('required')
  })
})
