import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  answerInterview,
  deleteInterviewSession,
  getInterviewReport,
  getInterviewSession,
  listInterviewSessions,
  startInterview,
  steerFromTranscript,
  type SessionStore
} from '../../src/main/ai/session'
import type {
  InterviewSessionDetail,
  InterviewSessionSummary,
  StoredInterviewSession
} from '../../src/main/db/repositories/interview'
import type { TranscriptTurn } from '../../src/main/ai/roles'

function summaryFields(s: StoredInterviewSession) {
  return {
    id: s.id,
    candidateName: s.candidateName,
    level: s.level,
    phase: s.state.phase,
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: s.state.phase === 'done' ? '2026-01-01T00:10:00Z' : null
  }
}

function fakeStore(): SessionStore {
  const sessions = new Map<string, StoredInterviewSession>()
  const turns = new Map<string, TranscriptTurn[]>()
  let seq = 0

  return {
    createSession(params) {
      const id = `sid-${++seq}`
      sessions.set(id, { id, report: null, ...params })
      turns.set(id, [{ speaker: 'interviewer', text: params.lastUtterance }])
      return id
    },
    loadSession(id) {
      return sessions.get(id) ?? null
    },
    transcript(id) {
      return turns.get(id) ?? []
    },
    commitAnswer(params) {
      const prev = sessions.get(params.sessionId)
      if (!prev) throw new Error('fake store: missing session')
      sessions.set(params.sessionId, {
        ...prev,
        state: params.state,
        lastAction: params.lastAction,
        lastUtterance: params.lastUtterance,
        report: params.report
      })
      turns.get(params.sessionId)!.push(
        { speaker: 'candidate', text: params.answer },
        { speaker: 'interviewer', text: params.lastUtterance }
      )
    },
    getSession(id): InterviewSessionDetail | null {
      const s = sessions.get(id)
      if (!s) return null
      return {
        ...summaryFields(s),
        report: s.report,
        transcript: turns.get(id) ?? []
      }
    },
    listSessions(): InterviewSessionSummary[] {
      return [...sessions.values()].map((s) => ({
        ...summaryFields(s),
        turnCount: turns.get(s.id)?.length ?? 0
      }))
    },
    deleteSession(id) {
      const existed = sessions.delete(id)
      turns.delete(id)
      return { deleted: existed }
    }
  }
}

const detailed =
  'I designed the ingestion system because we needed lower latency, so I architected a new pipeline. ' +
  'I chose Kafka instead of SQS after weighing the tradeoffs, and I owned the rollout end to end even ' +
  'after an outage forced a rollback that I led the fix on with the team over several days of on-call.'

async function runToDone(store: SessionStore) {
  const utterances: string[] = []
  let step = await startInterview(
    {
      resumeText: 'ignored',
      experiences: [{ id: 'a', title: 'Ingestion pipeline', summary: 'led the migration' }],
      budgetMs: 1000,
      closingReserveMs: 500
    },
    undefined,
    undefined,
    store
  )
  utterances.push(step.utterance)
  for (let i = 0; i < 5 && !step.done; i++) {
    step = await answerInterview(
      { sessionId: step.sessionId, answer: detailed, elapsedMs: i === 0 ? 0 : 1000 },
      undefined,
      undefined,
      store
    )
    utterances.push(step.utterance)
  }
  return { step, utterances }
}

describe('interview session — injected SessionStore (no getDb)', () => {
  beforeEach(() => vi.stubEnv('STARFOLIO_AI_STUB', '1'))
  afterEach(() => vi.unstubAllEnvs())

  it('opens with an intro question against a fake store', async () => {
    const step = await startInterview(
      { resumeText: 'ignored', experiences: [{ id: 'a', title: 'Ingestion pipeline' }] },
      undefined,
      undefined,
      fakeStore()
    )
    expect(step.phase).toBe('intro')
    expect(step.done).toBe(false)
    expect(step.utterance).toContain('yourself')
    expect(step.report).toBeNull()
  })

  it('drives a full interview to done and reads the report back through the store', async () => {
    const store = fakeStore()
    const { step } = await runToDone(store)
    expect(step.done).toBe(true)
    expect(step.phase).toBe('done')
    expect(step.report).not.toBeNull()
    expect(getInterviewReport(step.sessionId, store)).toEqual(step.report)
  })

  it('surfaces the session and its transcript through the detail getter', async () => {
    const store = fakeStore()
    const { step } = await runToDone(store)
    const detail = getInterviewSession(step.sessionId, store)
    expect(detail).not.toBeNull()
    expect(detail!.phase).toBe('done')
    expect(detail!.transcript.length).toBeGreaterThan(0)
    expect(detail!.transcript[0].speaker).toBe('interviewer')
  })

  it('lists then deletes a session through the store', async () => {
    const store = fakeStore()
    const first = await startInterview(
      { resumeText: 'ignored', experiences: [{ id: 'a', title: 'A' }] },
      undefined,
      undefined,
      store
    )
    expect(listInterviewSessions(store).map((s) => s.id)).toEqual([first.sessionId])
    expect(deleteInterviewSession(first.sessionId, store)).toEqual({ deleted: true })
    expect(listInterviewSessions(store)).toEqual([])
    expect(deleteInterviewSession(first.sessionId, store)).toEqual({ deleted: false })
  })

  it('steers from a live transcript without mutating the session', async () => {
    const store = fakeStore()
    const first = await startInterview(
      { resumeText: 'ignored', experiences: [{ id: 'a', title: 'Ingestion pipeline' }] },
      undefined,
      undefined,
      store
    )
    const evaluation = await steerFromTranscript(first.sessionId, detailed, undefined, store)
    expect(evaluation).toBeTruthy()
    expect(evaluation.coverageDeltas).toBeDefined()
  })

  it('returns an empty evaluation when steering an unknown session', async () => {
    const evaluation = await steerFromTranscript('nope', detailed, undefined, fakeStore())
    expect(evaluation.coverageDeltas).toEqual({})
    expect(evaluation.newThreads).toEqual([])
  })

  it('rejects an unknown session and an empty answer', async () => {
    const store = fakeStore()
    await expect(
      answerInterview({ sessionId: 'nope', answer: 'hi' }, undefined, undefined, store)
    ).rejects.toThrow('not found')
    expect(() => getInterviewReport('nope', store)).toThrow('not found')

    const first = await startInterview(
      { resumeText: 'ignored', experiences: [{ id: 'a', title: 'A' }] },
      undefined,
      undefined,
      store
    )
    await expect(
      answerInterview({ sessionId: first.sessionId, answer: '   ' }, undefined, undefined, store)
    ).rejects.toThrow('required')
  })

  it('rejects answering after the interview has ended', async () => {
    const store = fakeStore()
    const { step } = await runToDone(store)
    await expect(
      answerInterview({ sessionId: step.sessionId, answer: detailed }, undefined, undefined, store)
    ).rejects.toThrow('ended')
  })
})
