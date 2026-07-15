import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { initDb, getDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { startPractice, answerPractice } from '../../src/main/practice'
import {
  addInterviewerTurn,
  commitAnswer,
  createSession,
  deleteSession,
  deleteTechnicalSession,
  endTechnicalSession,
  getSession,
  getTechnicalSession,
  listSessions,
  listTechnicalSessions
} from '../../src/main/db/repositories/practice'
import type { TechnicalFeedback } from '../../src/main/ai/technical'

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

  it('refuses to answer once the session has ended (terminal state)', async () => {
    const { sessionId } = await startPractice({ kind: 'genre', promptText: 'Leadership' })
    await answerPractice({ sessionId, answer: STRONG })
    await answerPractice({ sessionId, answer: STRONG })
    await answerPractice({ sessionId, answer: STRONG })
    const list = listSessions()
    expect(list[0].ended_at).not.toBeNull()
    await expect(answerPractice({ sessionId, answer: STRONG })).rejects.toThrow(/ended/)
  })

  it('keeps technical sessions out of the behavioral history and get', async () => {
    const { sessionId: behavioral } = await startPractice({ kind: 'genre', promptText: 'Leadership' })
    const technical = createSession({ promptText: 'the rate limiter design' }, 'technical')

    const list = listSessions()
    expect(list.map((s) => s.id)).toEqual([behavioral])
    expect(getSession(technical)).toBeNull()
    expect(getSession(behavioral)).not.toBeNull()
  })

  it('lists and reads technical sessions with rubric feedback, isolated from behavioral', async () => {
    const { sessionId: behavioral } = await startPractice({ kind: 'genre', promptText: 'Leadership' })
    const technical = createSession(
      { promptText: 'the rate limiter design', discipline: 'distributed systems' },
      'technical'
    )
    getDb().prepare(`INSERT INTO corpus_docs (id, title) VALUES ('d1', 'Designing Data-Intensive Applications')`).run()
    getDb().prepare(`INSERT INTO corpus_chunks (id, doc_id, seq, text) VALUES ('ch1', 'd1', 0, 'rate limiting chapter')`).run()
    addInterviewerTurn(technical, 'How does your limiter behave under a network partition?', ['ch1'])
    const feedback: TechnicalFeedback = {
      correctness: { score: 4, note: 'sound' },
      depth: { score: 3, note: 'go deeper on failover' },
      tradeoffs: { score: 5, note: 'weighed CP vs AP well' },
      communication: { score: 4, note: 'clear' },
      summary: 'solid answer'
    }
    commitAnswer({
      sessionId: technical,
      answer: 'token bucket per node, gossip the counters',
      feedback,
      flags: {},
      experienceIds: [],
      next: { kind: 'done' }
    })

    const list = listTechnicalSessions()
    expect(list.map((s) => s.id)).toEqual([technical])
    expect(list[0].config.discipline).toBe('distributed systems')
    expect(list[0].question_count).toBe(1)
    expect(list[0].answered).toBe(1)

    const session = getTechnicalSession(technical)!
    expect(session.config.promptText).toBe('the rate limiter design')
    expect(session.turns).toHaveLength(2)
    const interviewer = session.turns.find((t) => t.role === 'interviewer')!
    expect(interviewer.citations).toEqual([
      { chunkId: 'ch1', title: 'Designing Data-Intensive Applications' }
    ])
    const candidate = session.turns.find((t) => t.role === 'candidate')!
    expect(candidate.citations).toEqual([])
    expect(candidate.feedback!.tradeoffs.score).toBe(5)
    expect(candidate.feedback!.summary).toBe('solid answer')

    expect(getTechnicalSession(behavioral)).toBeNull()
  })

  it('ends a technical session early and leaves behavioral sessions untouched', async () => {
    const { sessionId: behavioral } = await startPractice({ kind: 'genre', promptText: 'Leadership' })
    const technical = createSession({ promptText: 'the rate limiter design' }, 'technical')

    endTechnicalSession(technical)

    expect(getTechnicalSession(technical)!.ended_at).not.toBeNull()
    expect(getSession(behavioral)!.ended_at).toBeNull()

    endTechnicalSession(behavioral)
    expect(getSession(behavioral)!.ended_at).toBeNull()
  })

  it('deletes a technical session with its turns and refuses to touch behavioral sessions', async () => {
    const { sessionId: behavioral } = await startPractice({ kind: 'genre', promptText: 'Leadership' })
    const technical = createSession({ promptText: 'the rate limiter design' }, 'technical')
    addInterviewerTurn(technical, 'How does it behave under a partition?')

    expect(deleteTechnicalSession(behavioral)).toEqual({ deleted: false })
    expect(getSession(behavioral)).not.toBeNull()

    expect(deleteTechnicalSession(technical)).toEqual({ deleted: true })
    expect(getTechnicalSession(technical)).toBeNull()
    const turns = getDb()
      .prepare('SELECT count(*) AS n FROM practice_turns WHERE session_id = ?')
      .get(technical) as { n: number }
    expect(turns.n).toBe(0)
  })

  it('deletes a behavioral session with its turns and refuses to touch technical sessions', async () => {
    const { sessionId: behavioral } = await startPractice({ kind: 'genre', promptText: 'Leadership' })
    await answerPractice({ sessionId: behavioral, answer: STRONG })
    const technical = createSession({ promptText: 'the rate limiter design' }, 'technical')

    expect(deleteSession(technical)).toEqual({ deleted: false })
    expect(getTechnicalSession(technical)).not.toBeNull()

    expect(deleteSession(behavioral)).toEqual({ deleted: true })
    expect(getSession(behavioral)).toBeNull()
    const turns = getDb()
      .prepare('SELECT count(*) AS n FROM practice_turns WHERE session_id = ?')
      .get(behavioral) as { n: number }
    expect(turns.n).toBe(0)
  })
})
