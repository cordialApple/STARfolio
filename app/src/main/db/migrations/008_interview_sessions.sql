CREATE TABLE IF NOT EXISTS interview_sessions (
  id               TEXT PRIMARY KEY,
  candidate_name   TEXT,
  level            TEXT NOT NULL,
  phase            TEXT NOT NULL,
  state_json       TEXT NOT NULL,
  last_action_json TEXT NOT NULL,
  last_utterance   TEXT NOT NULL,
  started_at_ms    INTEGER NOT NULL,
  report_json      TEXT,
  started_at       TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at         TEXT
);

CREATE TABLE IF NOT EXISTS interview_turns (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  speaker    TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interview_turns_session
  ON interview_turns (session_id, created_at);
