import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { startPractice, answerPractice } from '../../src/main/practice'
import { getSession, listSessions } from '../../src/main/db/repositories/practice'

const STRONG =
  'When the deploy pipeline kept failing I took ownership, rewrote the retry logic, and cut build times from 20 minutes to 4 for the whole team.'

describe('practice orchestrator (stub)', () => {
  beforeAll(() => {
    process.env.STARFOLIO_AI_STUB = '1'
  })
  afterAll(() => {
    delete process.env.STARFOLIO_AI_STUB
  })
  beforeEach(() => {
    initDb(':memory:')
    createExperience({
      title: 'Deploy pipeline rewrite',
      action: 'Rewrote CI retry logic',
      context: 'work',
      status: 'confirmed'
    } as unknown)
  })

  it('starts a session and asks a first question', async () => {
    const { sessionId, question } = await startPractice({ kind: 'genre', promptText: 'Leadership' })
    expect(question.length).toBeGreaterThan(0)
    const session = getSession(sessionId)!
    expect(session.turns).toHaveLength(1)
    expect(session.turns[0].role).toBe('interviewer')
    expect(session.ended_at).toBeNull()
  })

  it('persists an answer with feedback and drills down on a vague reply', async () => {
    const { sessionId } = await startPractice({ kind: 'genre', promptText: 'Leadership' })
    const res = await answerPractice({ sessionId, answer: 'It went okay I guess.' })
    expect(res.next_kind).toBe('drilldown')

    const session = getSession(sessionId)!
    const candidate = session.turns.find((t) => t.role === 'candidate')!
    expect(candidate.feedback).not.toBeNull()
    expect(candidate.feedback!.measurable_result.score).toBeLessThanOrEqual(2)
    // interviewer Q1 + candidate answer + interviewer drill-down = 3 turns
    expect(session.turns).toHaveLength(3)
    expect(session.turns[2].role).toBe('interviewer')
  })

  it('links a strong answer to the banked experience and advances', async () => {
    const { sessionId } = await startPractice({ kind: 'genre', promptText: 'Leadership' })
    const res = await answerPractice({ sessionId, answer: STRONG })
    expect(res.next_kind).toBe('question')
    expect(res.used.map((u) => u.title)).toContain('Deploy pipeline rewrite')

    const session = getSession(sessionId)!
    const candidate = session.turns.find((t) => t.role === 'candidate')!
    expect(candidate.experiences.map((e) => e.title)).toContain('Deploy pipeline rewrite')
    expect(candidate.flags?.unbanked).toBe(false)
  })

  it('ends the session and lists it in history', async () => {
    const { sessionId } = await startPractice({ kind: 'genre', promptText: 'Leadership' })
    await answerPractice({ sessionId, answer: STRONG })
    const list = listSessions()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(sessionId)
    expect(list[0].answered).toBe(1)
  })
})
