import { getDb } from '../client'
import type { MoshiInterviewSnapshot } from '../../ai/moshi-interview'

export function saveMoshiInterview(snapshot: MoshiInterviewSnapshot): void {
  const db = getDb()
  db.transaction(() => {
    const lastAction = snapshot.conditioning.at(-1)?.action.intent ?? { kind: 'ask_intro' }
    const lastUtterance =
      snapshot.transcript.filter((entry) => entry.speaker === 'interviewer').at(-1)?.text ?? ''
    const ended = ['finished', 'cancelled', 'failed'].includes(snapshot.status)
    db.prepare(
      `INSERT INTO interview_sessions
      (id, candidate_name, level, phase, state_json, last_action_json, last_utterance, started_at_ms, report_json, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN datetime('now') ELSE NULL END)
      ON CONFLICT(id) DO UPDATE SET phase=excluded.phase, state_json=excluded.state_json,
        last_action_json=excluded.last_action_json, last_utterance=excluded.last_utterance,
        report_json=excluded.report_json, ended_at=coalesce(interview_sessions.ended_at, excluded.ended_at)`
    ).run(
      snapshot.id,
      snapshot.candidateName,
      snapshot.state.candidate.level,
      snapshot.state.phase,
      JSON.stringify(snapshot.state),
      JSON.stringify(lastAction),
      lastUtterance,
      snapshot.startedAtMs,
      snapshot.report ? JSON.stringify(snapshot.report) : null,
      ended ? 1 : 0
    )
    const stored = db
      .prepare(
        'SELECT rowid, speaker, text FROM interview_turns WHERE session_id = ? ORDER BY rowid'
      )
      .all(snapshot.id) as Array<{ rowid: number; speaker: string; text: string }>
    let shared = 0
    while (
      shared < stored.length &&
      shared < snapshot.transcript.length &&
      stored[shared].speaker === snapshot.transcript[shared].speaker &&
      stored[shared].text === snapshot.transcript[shared].text
    )
      shared++
    if (shared < stored.length)
      db.prepare('DELETE FROM interview_turns WHERE session_id = ? AND rowid >= ?').run(
        snapshot.id,
        stored[shared].rowid
      )
    const insert = db.prepare(
      'INSERT INTO interview_turns (id, session_id, speaker, text) VALUES (?, ?, ?, ?)'
    )
    for (let index = shared; index < snapshot.transcript.length; index++) {
      const entry = snapshot.transcript[index]
      insert.run(`${snapshot.id}-segment-${index}`, snapshot.id, entry.speaker, entry.text)
    }
    db.prepare(
      `INSERT INTO moshi_interview_audit (session_id, snapshot_json) VALUES (?, ?)
      ON CONFLICT(session_id) DO UPDATE SET snapshot_json=excluded.snapshot_json, updated_at=datetime('now')`
    ).run(snapshot.id, JSON.stringify(snapshot))
  })()
}

export function loadMoshiInterview(sessionId: string): MoshiInterviewSnapshot | null {
  const row = getDb()
    .prepare('SELECT snapshot_json FROM moshi_interview_audit WHERE session_id = ?')
    .get(sessionId) as { snapshot_json: string } | undefined
  return row ? (JSON.parse(row.snapshot_json) as MoshiInterviewSnapshot) : null
}
