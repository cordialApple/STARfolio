import { randomUUID } from 'crypto'
import { getDb } from '../client'
import type { ExperienceLevel, InterviewAction, InterviewState } from '../../ai/roadmap'
import type { InterviewReport, TranscriptTurn } from '../../ai/roles'

export interface StoredInterviewSession {
  id: string
  candidateName: string | null
  level: ExperienceLevel
  state: InterviewState
  lastAction: InterviewAction
  lastUtterance: string
  startedAtMs: number
  report: InterviewReport | null
}

export interface InterviewSessionDetail {
  id: string
  candidateName: string | null
  level: ExperienceLevel
  phase: InterviewState['phase']
  startedAt: string
  endedAt: string | null
  report: InterviewReport | null
  transcript: TranscriptTurn[]
}

export interface InterviewSessionSummary {
  id: string
  candidateName: string | null
  level: ExperienceLevel
  phase: InterviewState['phase']
  startedAt: string
  endedAt: string | null
  turnCount: number
}

interface SessionRow {
  id: string
  candidate_name: string | null
  level: string
  phase: string
  state_json: string
  last_action_json: string
  last_utterance: string
  started_at_ms: number
  report_json: string | null
  started_at: string
  ended_at: string | null
}

function parseReport(json: string | null): InterviewReport | null {
  if (!json) return null
  try {
    return JSON.parse(json) as InterviewReport
  } catch {
    return null
  }
}

function toStored(row: SessionRow): StoredInterviewSession {
  return {
    id: row.id,
    candidateName: row.candidate_name,
    level: row.level as ExperienceLevel,
    state: JSON.parse(row.state_json) as InterviewState,
    lastAction: JSON.parse(row.last_action_json) as InterviewAction,
    lastUtterance: row.last_utterance,
    startedAtMs: row.started_at_ms,
    report: parseReport(row.report_json)
  }
}

export function createSession(params: {
  candidateName: string | null
  level: ExperienceLevel
  state: InterviewState
  lastAction: InterviewAction
  lastUtterance: string
  startedAtMs: number
}): string {
  const id = randomUUID()
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO interview_sessions
         (id, candidate_name, level, phase, state_json, last_action_json, last_utterance, started_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.candidateName,
      params.level,
      params.state.phase,
      JSON.stringify(params.state),
      JSON.stringify(params.lastAction),
      params.lastUtterance,
      params.startedAtMs
    )
    db.prepare(
      `INSERT INTO interview_turns (id, session_id, speaker, text) VALUES (?, ?, 'interviewer', ?)`
    ).run(randomUUID(), id, params.lastUtterance)
  })()
  return id
}

export function loadSession(sessionId: string): StoredInterviewSession | null {
  const row = getDb()
    .prepare('SELECT * FROM interview_sessions WHERE id = ?')
    .get(sessionId) as SessionRow | undefined
  return row ? toStored(row) : null
}

export function transcript(sessionId: string): TranscriptTurn[] {
  return getDb()
    .prepare(
      `SELECT speaker, text FROM interview_turns WHERE session_id = ? ORDER BY created_at, rowid`
    )
    .all(sessionId) as TranscriptTurn[]
}

// The candidate's answer and the interviewer's next utterance plus the engine-state advance
// commit as one transaction, so a crash can never strand a session mid-turn.
export function commitAnswer(params: {
  sessionId: string
  answer: string
  state: InterviewState
  lastAction: InterviewAction
  lastUtterance: string
  report: InterviewReport | null
}): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO interview_turns (id, session_id, speaker, text) VALUES (?, ?, 'candidate', ?)`
    ).run(randomUUID(), params.sessionId, params.answer)
    db.prepare(
      `INSERT INTO interview_turns (id, session_id, speaker, text) VALUES (?, ?, 'interviewer', ?)`
    ).run(randomUUID(), params.sessionId, params.lastUtterance)
    const done = params.state.phase === 'done'
    db.prepare(
      `UPDATE interview_sessions
         SET phase = ?, state_json = ?, last_action_json = ?, last_utterance = ?, report_json = ?,
             ended_at = CASE WHEN ? AND ended_at IS NULL THEN datetime('now') ELSE ended_at END
       WHERE id = ?`
    ).run(
      params.state.phase,
      JSON.stringify(params.state),
      JSON.stringify(params.lastAction),
      params.lastUtterance,
      params.report ? JSON.stringify(params.report) : null,
      done ? 1 : 0,
      params.sessionId
    )
  })()
}

export function getSession(sessionId: string): InterviewSessionDetail | null {
  const row = getDb()
    .prepare('SELECT * FROM interview_sessions WHERE id = ?')
    .get(sessionId) as SessionRow | undefined
  if (!row) return null
  return {
    id: row.id,
    candidateName: row.candidate_name,
    level: row.level as ExperienceLevel,
    phase: row.phase as InterviewState['phase'],
    startedAt: row.started_at,
    endedAt: row.ended_at,
    report: parseReport(row.report_json),
    transcript: transcript(sessionId)
  }
}

export function listSessions(): InterviewSessionSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.candidate_name, s.level, s.phase, s.started_at, s.ended_at,
              (SELECT count(*) FROM interview_turns t WHERE t.session_id = s.id) AS turn_count
       FROM interview_sessions s ORDER BY s.started_at DESC, s.rowid DESC LIMIT 200`
    )
    .all() as (Pick<
    SessionRow,
    'id' | 'candidate_name' | 'level' | 'phase' | 'started_at' | 'ended_at'
  > & { turn_count: number })[]
  return rows.map((r) => ({
    id: r.id,
    candidateName: r.candidate_name,
    level: r.level as ExperienceLevel,
    phase: r.phase as InterviewState['phase'],
    startedAt: r.started_at,
    endedAt: r.ended_at,
    turnCount: r.turn_count
  }))
}
