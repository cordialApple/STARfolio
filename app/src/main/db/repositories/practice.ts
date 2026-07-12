import { randomUUID } from 'crypto'
import { getDb } from '../client'
import { practiceConfig, type InterviewFeedback, type PracticeConfig } from '../../ai/interview'

export type TurnRole = 'interviewer' | 'candidate'
export interface TurnFlags {
  unbanked?: boolean
}
export interface TurnExperienceRef {
  id: string
  title: string
}
export interface PracticeTurn {
  id: string
  role: TurnRole
  content: string
  feedback: InterviewFeedback | null
  flags: TurnFlags | null
  experiences: TurnExperienceRef[]
  created_at: string
}
export interface PracticeSession {
  id: string
  config: PracticeConfig
  started_at: string
  ended_at: string | null
  turns: PracticeTurn[]
}
export interface PracticeSessionSummary {
  id: string
  config: PracticeConfig
  started_at: string
  ended_at: string | null
  question_count: number
  answered: number
}

function parseConfig(json: string | null): PracticeConfig {
  try {
    return practiceConfig.parse(JSON.parse(json ?? '{}'))
  } catch {
    return { kind: 'genre', promptText: 'practice' }
  }
}

export function createSession(config: unknown, mode: 'behavioral' | 'technical' = 'behavioral'): string {
  const id = randomUUID()
  getDb()
    .prepare('INSERT INTO practice_sessions (id, mode, config_json) VALUES (?, ?, ?)')
    .run(id, mode, JSON.stringify(config))
  return id
}

export function sessionMode(sessionId: string): 'behavioral' | 'technical' | null {
  const row = getDb()
    .prepare('SELECT mode FROM practice_sessions WHERE id = ?')
    .get(sessionId) as { mode: string } | undefined
  return row ? (row.mode === 'technical' ? 'technical' : 'behavioral') : null
}

function linkTurnChunks(db: ReturnType<typeof getDb>, turnId: string, chunkIds: string[]): void {
  const link = db.prepare(
    'INSERT OR IGNORE INTO practice_turn_corpus_chunks (turn_id, chunk_id) VALUES (?, ?)'
  )
  for (const id of chunkIds) {
    if (db.prepare('SELECT 1 FROM corpus_chunks WHERE id = ?').get(id)) link.run(turnId, id)
  }
}

export function sessionConfig(sessionId: string): PracticeConfig | null {
  const row = getDb()
    .prepare('SELECT config_json FROM practice_sessions WHERE id = ?')
    .get(sessionId) as { config_json: string | null } | undefined
  return row ? parseConfig(row.config_json) : null
}

export function rawSessionConfig(sessionId: string): string | null {
  const row = getDb()
    .prepare('SELECT config_json FROM practice_sessions WHERE id = ?')
    .get(sessionId) as { config_json: string | null } | undefined
  return row ? row.config_json : null
}

export function askedQuestions(sessionId: string): string[] {
  return (
    getDb()
      .prepare(
        `SELECT content FROM practice_turns WHERE session_id = ? AND role = 'interviewer'
         ORDER BY created_at, rowid`
      )
      .all(sessionId) as { content: string }[]
  ).map((r) => r.content)
}

export function currentQuestion(sessionId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT content FROM practice_turns WHERE session_id = ? AND role = 'interviewer'
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(sessionId) as { content: string } | undefined
  return row?.content ?? null
}

export function addInterviewerTurn(sessionId: string, content: string, chunkIds: string[] = []): void {
  const db = getDb()
  const turnId = randomUUID()
  db.transaction(() => {
    db.prepare(`INSERT INTO practice_turns (id, session_id, role, content) VALUES (?, ?, 'interviewer', ?)`)
      .run(turnId, sessionId, content)
    linkTurnChunks(db, turnId, chunkIds)
  })()
}

export function isSessionOpen(sessionId: string): boolean {
  const row = getDb()
    .prepare('SELECT ended_at FROM practice_sessions WHERE id = ?')
    .get(sessionId) as { ended_at: string | null } | undefined
  return row != null && row.ended_at === null
}

export type NextMove = { kind: 'ask'; text: string; chunkIds?: string[] } | { kind: 'done' }

// The candidate's answer (with feedback, flags, provenance links) AND the state transition it
// causes — either the next interviewer turn or ending the session — commit as one transaction,
// so a crash can never strand a session in an "answered but no next question, not ended" state.
export function commitAnswer(params: {
  sessionId: string
  answer: string
  feedback: object
  flags: TurnFlags
  experienceIds: string[]
  next: NextMove
}): void {
  const db = getDb()
  const turnId = randomUUID()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO practice_turns (id, session_id, role, content, feedback_json, flags_json)
       VALUES (?, ?, 'candidate', ?, ?, ?)`
    ).run(turnId, params.sessionId, params.answer, JSON.stringify(params.feedback), JSON.stringify(params.flags))
    const link = db.prepare(
      'INSERT OR IGNORE INTO practice_turn_experiences (turn_id, experience_id) VALUES (?, ?)'
    )
    for (const expId of params.experienceIds) {
      if (db.prepare('SELECT 1 FROM experiences WHERE id = ?').get(expId)) link.run(turnId, expId)
    }
    if (params.next.kind === 'ask') {
      const nextId = randomUUID()
      db.prepare(`INSERT INTO practice_turns (id, session_id, role, content) VALUES (?, ?, 'interviewer', ?)`)
        .run(nextId, params.sessionId, params.next.text)
      linkTurnChunks(db, nextId, params.next.chunkIds ?? [])
    } else {
      db.prepare(`UPDATE practice_sessions SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL`)
        .run(params.sessionId)
    }
  })()
}

export function endSession(sessionId: string): void {
  getDb()
    .prepare(`UPDATE practice_sessions SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL`)
    .run(sessionId)
}

function turnExperiences(turnId: string): TurnExperienceRef[] {
  return getDb()
    .prepare(
      `SELECT e.id, e.title FROM practice_turn_experiences pte
       JOIN experiences e ON e.id = pte.experience_id WHERE pte.turn_id = ? ORDER BY e.title`
    )
    .all(turnId) as TurnExperienceRef[]
}

function parseFeedback(json: string | null): InterviewFeedback | null {
  if (!json) return null
  try {
    return JSON.parse(json) as InterviewFeedback
  } catch {
    return null
  }
}
function parseFlags(json: string | null): TurnFlags | null {
  if (!json) return null
  try {
    return JSON.parse(json) as TurnFlags
  } catch {
    return null
  }
}

export function getSession(sessionId: string): PracticeSession | null {
  const s = getDb()
    .prepare('SELECT id, config_json, started_at, ended_at FROM practice_sessions WHERE id = ?')
    .get(sessionId) as
    | { id: string; config_json: string | null; started_at: string; ended_at: string | null }
    | undefined
  if (!s) return null

  const rows = getDb()
    .prepare(
      `SELECT id, role, content, feedback_json, flags_json, created_at
       FROM practice_turns WHERE session_id = ? ORDER BY created_at, rowid`
    )
    .all(sessionId) as {
    id: string
    role: TurnRole
    content: string
    feedback_json: string | null
    flags_json: string | null
    created_at: string
  }[]

  return {
    id: s.id,
    config: parseConfig(s.config_json),
    started_at: s.started_at,
    ended_at: s.ended_at,
    turns: rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      feedback: parseFeedback(r.feedback_json),
      flags: parseFlags(r.flags_json),
      experiences: r.role === 'candidate' ? turnExperiences(r.id) : [],
      created_at: r.created_at
    }))
  }
}

export function listSessions(): PracticeSessionSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.config_json, s.started_at, s.ended_at,
              (SELECT count(*) FROM practice_turns t WHERE t.session_id = s.id AND t.role = 'interviewer') AS question_count,
              (SELECT count(*) FROM practice_turns t WHERE t.session_id = s.id AND t.role = 'candidate') AS answered
       FROM practice_sessions s ORDER BY s.started_at DESC, s.rowid DESC LIMIT 200`
    )
    .all() as {
    id: string
    config_json: string | null
    started_at: string
    ended_at: string | null
    question_count: number
    answered: number
  }[]
  return rows.map((r) => ({
    id: r.id,
    config: parseConfig(r.config_json),
    started_at: r.started_at,
    ended_at: r.ended_at,
    question_count: r.question_count,
    answered: r.answered
  }))
}
