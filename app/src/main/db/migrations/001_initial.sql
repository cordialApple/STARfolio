PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiences (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT '',
  situation       TEXT NOT NULL DEFAULT '',
  task            TEXT NOT NULL DEFAULT '',
  action          TEXT NOT NULL DEFAULT '',
  result_text     TEXT NOT NULL DEFAULT '',
  context         TEXT NOT NULL DEFAULT 'work',
  happened_start  TEXT,
  happened_end    TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  draft_state_json TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skills (
  id   TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'technical'
);

CREATE TABLE IF NOT EXISTS experience_skills (
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  skill_id      TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (experience_id, skill_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id   TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS experience_tags (
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  tag_id        TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (experience_id, tag_id)
);

CREATE TABLE IF NOT EXISTS metrics (
  id            TEXT PRIMARY KEY,
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  value         REAL,
  unit          TEXT
);

CREATE TABLE IF NOT EXISTS sources (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  uri_or_path     TEXT,
  attachment_path TEXT,
  title           TEXT,
  raw_text        TEXT,
  meta_json       TEXT,
  content_hash    TEXT,
  ingested_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experience_sources (
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (experience_id, source_id)
);

CREATE TABLE IF NOT EXISTS corpus_docs (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  discipline TEXT,
  source_id  TEXT REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS corpus_chunks (
  id     TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES corpus_docs(id) ON DELETE CASCADE,
  seq    INTEGER NOT NULL,
  text   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id          TEXT PRIMARY KEY,
  mode        TEXT NOT NULL,
  config_json TEXT,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT
);

CREATE TABLE IF NOT EXISTS practice_turns (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  content       TEXT NOT NULL,
  feedback_json TEXT,
  flags_json    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS practice_turn_experiences (
  turn_id       TEXT NOT NULL REFERENCES practice_turns(id) ON DELETE CASCADE,
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  PRIMARY KEY (turn_id, experience_id)
);

CREATE TABLE IF NOT EXISTS stories (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL DEFAULT 'story',
  prompt_json         TEXT,
  content             TEXT NOT NULL DEFAULT '',
  experience_ids_json TEXT,
  parent_story_id     TEXT REFERENCES stories(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage_log (
  id                TEXT PRIMARY KEY,
  ts                TEXT NOT NULL DEFAULT (datetime('now')),
  model             TEXT NOT NULL,
  in_tokens         INTEGER NOT NULL DEFAULT 0,
  out_tokens        INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  feature           TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS experiences_fts USING fts5(
  title, situation, task, action, result_text,
  content='experiences', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS experiences_fts_ai AFTER INSERT ON experiences BEGIN
  INSERT INTO experiences_fts(rowid, title, situation, task, action, result_text)
  VALUES (new.rowid, new.title, new.situation, new.task, new.action, new.result_text);
END;

CREATE TRIGGER IF NOT EXISTS experiences_fts_ad AFTER DELETE ON experiences BEGIN
  INSERT INTO experiences_fts(experiences_fts, rowid, title, situation, task, action, result_text)
  VALUES ('delete', old.rowid, old.title, old.situation, old.task, old.action, old.result_text);
END;

CREATE TRIGGER IF NOT EXISTS experiences_fts_au AFTER UPDATE ON experiences BEGIN
  INSERT INTO experiences_fts(experiences_fts, rowid, title, situation, task, action, result_text)
  VALUES ('delete', old.rowid, old.title, old.situation, old.task, old.action, old.result_text);
  INSERT INTO experiences_fts(rowid, title, situation, task, action, result_text)
  VALUES (new.rowid, new.title, new.situation, new.task, new.action, new.result_text);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS corpus_fts USING fts5(
  text,
  content='corpus_chunks', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS corpus_fts_ai AFTER INSERT ON corpus_chunks BEGIN
  INSERT INTO corpus_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS corpus_fts_ad AFTER DELETE ON corpus_chunks BEGIN
  INSERT INTO corpus_fts(corpus_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS corpus_fts_au AFTER UPDATE ON corpus_chunks BEGIN
  INSERT INTO corpus_fts(corpus_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO corpus_fts(rowid, text) VALUES (new.rowid, new.text);
END;

INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
