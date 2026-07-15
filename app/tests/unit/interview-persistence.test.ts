import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDb, initDb } from '../../src/main/db/client'
import {
  startInterview,
  answerInterview,
  getInterviewReport,
  listInterviewSessions,
  getInterviewSession,
  deleteInterviewSession
} from '../../src/main/ai/session'

const detailed =
  'I designed the ingestion system because we needed lower latency, so I architected a new pipeline. ' +
  'I chose Kafka instead of SQS after weighing the tradeoffs, and I owned the rollout end to end even ' +
  'after an outage forced a rollback that I led the fix on with the team over several days of on-call.'

let dir: string
let dbPath: string

function reopen(): void {
  getDb().close()
  initDb(dbPath)
}

beforeEach(() => {
  vi.stubEnv('STARFOLIO_AI_STUB', '1')
  dir = mkdtempSync(join(tmpdir(), 'interview-persist-'))
  dbPath = join(dir, 'test.db')
  initDb(dbPath)
})

afterEach(() => {
  try {
    getDb().close()
  } catch {
    // already closed
  }
  vi.unstubAllEnvs()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Windows can hold the WAL sidecar briefly after close; a leaked temp file must not fail the suite.
  }
})

describe('interview persistence', () => {
  it('round-trips a session through the DB and lists it in history', async () => {
    const start = await startInterview({
      resumeText: 'ignored',
      experiences: [{ id: 'a', title: 'Ingestion pipeline', summary: 'led the migration' }],
      candidateName: 'Ada',
      budgetMs: 1000,
      closingReserveMs: 500
    })

    const detail = getInterviewSession(start.sessionId)!
    expect(detail.candidateName).toBe('Ada')
    expect(detail.phase).toBe('intro')
    expect(detail.transcript).toHaveLength(1)
    expect(detail.transcript[0].speaker).toBe('interviewer')
    expect(detail.transcript[0].text).toBe(start.utterance)

    const list = listInterviewSessions()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(start.sessionId)
    expect(list[0].candidateName).toBe('Ada')
    expect(list[0].turnCount).toBe(1)
  })

  it('resumes a session across a simulated app restart and finishes to a report', async () => {
    const start = await startInterview({
      resumeText: 'ignored',
      experiences: [{ id: 'a', title: 'Ingestion pipeline', summary: 'led the migration' }],
      budgetMs: 1000,
      closingReserveMs: 500
    })
    const sessionId = start.sessionId

    let step = await answerInterview({ sessionId, answer: detailed, elapsedMs: 0 })
    expect(step.done).toBe(false)

    reopen()

    for (let i = 0; i < 5 && !step.done; i++) {
      step = await answerInterview({ sessionId, answer: detailed, elapsedMs: 1000 })
      if (i === 1) reopen()
    }

    expect(step.done).toBe(true)
    expect(step.phase).toBe('done')

    reopen()
    const report = getInterviewReport(sessionId)
    expect(report).not.toBeNull()
    expect(report!.starStories.length).toBeGreaterThan(0)

    const detail = getInterviewSession(sessionId)!
    expect(detail.phase).toBe('done')
    expect(detail.endedAt).not.toBeNull()
    expect(detail.transcript.filter((t) => t.speaker === 'candidate').length).toBeGreaterThan(0)
    expect(detail.transcript[detail.transcript.length - 1].speaker).toBe('interviewer')
  })

  it('deletes a session and cascades its turns out of history', async () => {
    const start = await startInterview({
      resumeText: 'ignored',
      experiences: [{ id: 'a', title: 'Ingestion pipeline', summary: 'led the migration' }],
      candidateName: 'Deletable',
      budgetMs: 1000,
      closingReserveMs: 500
    })
    await answerInterview({ sessionId: start.sessionId, answer: detailed, elapsedMs: 0 })
    expect(listInterviewSessions()).toHaveLength(1)

    expect(deleteInterviewSession(start.sessionId)).toEqual({ deleted: true })

    expect(listInterviewSessions()).toHaveLength(0)
    expect(getInterviewSession(start.sessionId)).toBeNull()
    expect(() => getInterviewReport(start.sessionId)).toThrow('not found')
    const turns = getDb()
      .prepare('SELECT count(*) AS n FROM interview_turns WHERE session_id = ?')
      .get(start.sessionId) as { n: number }
    expect(turns.n).toBe(0)

    expect(deleteInterviewSession(start.sessionId)).toEqual({ deleted: false })
  })

  it('rejects answering a session that already ended after a restart', async () => {
    const start = await startInterview({
      resumeText: 'ignored',
      experiences: [{ id: 'a', title: 'Ingestion pipeline' }],
      budgetMs: 1000,
      closingReserveMs: 500
    })
    let step = start
    for (let i = 0; i < 6 && !step.done; i++) {
      step = await answerInterview({ sessionId: start.sessionId, answer: detailed, elapsedMs: i === 0 ? 0 : 1000 })
    }
    expect(step.done).toBe(true)

    reopen()
    await expect(
      answerInterview({ sessionId: start.sessionId, answer: detailed })
    ).rejects.toThrow('ended')
    expect(existsSync(dbPath)).toBe(true)
  })
})
