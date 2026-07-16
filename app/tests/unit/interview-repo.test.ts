import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDb, initDb } from '../../src/main/db/client'
import {
  createSession,
  loadSession,
  transcript,
  commitAnswer,
  getSession,
  deleteSession,
  listSessions
} from '../../src/main/db/repositories/interview'
import type { InterviewState, InterviewAction } from '../../src/main/ai/roadmap'
import type { InterviewReport } from '../../src/main/ai/roles'

let dir: string

function state(phase: InterviewState['phase']): InterviewState {
  return { phase } as unknown as InterviewState
}

function action(kind: string): InterviewAction {
  return { kind } as unknown as InterviewAction
}

function sampleReport(): InterviewReport {
  return {
    overallFeedback: 'solid',
    strengths: ['ownership'],
    improvementAreas: ['tradeoffs'],
    starStories: [
      { topic: 'ingestion', situation: 's', task: 't', action: 'a', result: 'r' }
    ]
  }
}

function seed(
  overrides: Partial<Parameters<typeof createSession>[0]> = {}
): string {
  return createSession({
    candidateName: 'Ada',
    level: 'mid',
    state: state('intro'),
    lastAction: action('ask_intro'),
    lastUtterance: 'Tell me about your work.',
    startedAtMs: 1_700_000_000_000,
    ...overrides
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'interview-repo-'))
  initDb(join(dir, 'test.db'))
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
    // Windows may hold the WAL sidecar briefly after close; a leaked temp file must not fail the suite.
  }
})

describe('interview repository', () => {
  it('createSession seeds exactly one interviewer turn with the opening utterance', () => {
    const id = seed({ lastUtterance: 'Opening line.' })
    const turns = transcript(id)
    expect(turns).toHaveLength(1)
    expect(turns[0]).toEqual({ speaker: 'interviewer', text: 'Opening line.' })
  })

  it('loadSession round-trips fields and returns null report initially', () => {
    const id = seed()
    const loaded = loadSession(id)!
    expect(loaded.candidateName).toBe('Ada')
    expect(loaded.level).toBe('mid')
    expect(loaded.state.phase).toBe('intro')
    expect(loaded.lastAction).toEqual(action('ask_intro'))
    expect(loaded.lastUtterance).toBe('Tell me about your work.')
    expect(loaded.startedAtMs).toBe(1_700_000_000_000)
    expect(loaded.report).toBeNull()
  })

  it('loadSession returns null for a missing id', () => {
    expect(loadSession('nope')).toBeNull()
  })

  it('createSession stores a null candidateName', () => {
    const id = seed({ candidateName: null })
    expect(loadSession(id)!.candidateName).toBeNull()
  })

  it('commitAnswer appends candidate+interviewer turns in order and advances state', () => {
    const id = seed()
    commitAnswer({
      sessionId: id,
      answer: 'my answer',
      state: state('exploration'),
      lastAction: action('probe'),
      lastUtterance: 'follow up',
      report: null
    })
    const turns = transcript(id)
    expect(turns.map((t) => t.speaker)).toEqual(['interviewer', 'candidate', 'interviewer'])
    expect(turns[1]).toEqual({ speaker: 'candidate', text: 'my answer' })
    expect(turns[2]).toEqual({ speaker: 'interviewer', text: 'follow up' })
    const loaded = loadSession(id)!
    expect(loaded.state.phase).toBe('exploration')
    expect(loaded.lastAction).toEqual(action('probe'))
    expect(loaded.lastUtterance).toBe('follow up')
  })

  it('commitAnswer does not set ended_at while phase is not done', () => {
    const id = seed()
    commitAnswer({
      sessionId: id,
      answer: 'a',
      state: state('exploration'),
      lastAction: action('probe'),
      lastUtterance: 'u',
      report: null
    })
    expect(getSession(id)!.endedAt).toBeNull()
  })

  it('stamps ended_at set-once on the first done commit and never overwrites it', () => {
    const id = seed()
    commitAnswer({
      sessionId: id,
      answer: 'final',
      state: state('done'),
      lastAction: action('done'),
      lastUtterance: 'thanks',
      report: null
    })
    const firstEnded = getSession(id)!.endedAt
    expect(firstEnded).not.toBeNull()

    const sentinel = '2000-01-01 00:00:00'
    getDb()
      .prepare('UPDATE interview_sessions SET ended_at=? WHERE id=?')
      .run(sentinel, id)

    commitAnswer({
      sessionId: id,
      answer: 'again',
      state: state('done'),
      lastAction: action('done'),
      lastUtterance: 'bye',
      report: null
    })
    expect(getSession(id)!.endedAt).toBe(sentinel)
  })

  it('round-trips a report when provided', () => {
    const id = seed()
    const report = sampleReport()
    commitAnswer({
      sessionId: id,
      answer: 'final',
      state: state('done'),
      lastAction: action('done'),
      lastUtterance: 'thanks',
      report
    })
    expect(loadSession(id)!.report).toEqual(report)
    expect(getSession(id)!.report).toEqual(report)
  })

  it('treats a malformed report_json as null instead of throwing', () => {
    const id = seed()
    getDb()
      .prepare('UPDATE interview_sessions SET report_json=? WHERE id=?')
      .run('{not json', id)
    expect(() => loadSession(id)).not.toThrow()
    expect(loadSession(id)!.report).toBeNull()
    expect(getSession(id)!.report).toBeNull()
  })

  it('getSession returns full ordered transcript and null for a missing id', () => {
    const id = seed()
    commitAnswer({
      sessionId: id,
      answer: 'a',
      state: state('exploration'),
      lastAction: action('probe'),
      lastUtterance: 'u',
      report: null
    })
    const detail = getSession(id)!
    expect(detail.phase).toBe('exploration')
    expect(detail.transcript).toHaveLength(3)
    expect(detail.transcript.map((t) => t.speaker)).toEqual([
      'interviewer',
      'candidate',
      'interviewer'
    ])
    expect(getSession('missing')).toBeNull()
  })

  it('listSessions is empty on a fresh store', () => {
    expect(listSessions()).toEqual([])
  })

  it('listSessions returns newest-first with correct turn counts', () => {
    const older = seed({ candidateName: 'Older', startedAtMs: 1_700_000_000_000 })
    getDb()
      .prepare("UPDATE interview_sessions SET started_at='2000-01-01 00:00:00' WHERE id=?")
      .run(older)
    const newer = seed({ candidateName: 'Newer', startedAtMs: 1_700_000_001_000 })
    getDb()
      .prepare("UPDATE interview_sessions SET started_at='2030-01-01 00:00:00' WHERE id=?")
      .run(newer)

    commitAnswer({
      sessionId: newer,
      answer: 'a',
      state: state('exploration'),
      lastAction: action('probe'),
      lastUtterance: 'u',
      report: null
    })

    const list = listSessions()
    expect(list.map((s) => s.id)).toEqual([newer, older])
    expect(list[0].turnCount).toBe(3)
    expect(list[1].turnCount).toBe(1)
  })

  it('deleteSession cascades turns and reports whether a row was removed', () => {
    const id = seed()
    commitAnswer({
      sessionId: id,
      answer: 'a',
      state: state('exploration'),
      lastAction: action('probe'),
      lastUtterance: 'u',
      report: null
    })
    expect(deleteSession(id)).toEqual({ deleted: true })
    expect(transcript(id)).toHaveLength(0)
    expect(loadSession(id)).toBeNull()
    expect(deleteSession(id)).toEqual({ deleted: false })
  })
})
