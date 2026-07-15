import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startInterview, answerInterview, getInterviewReport } from '../../src/main/ai/session'

beforeEach(() => vi.stubEnv('STARFOLIO_AI_STUB', '1'))
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
