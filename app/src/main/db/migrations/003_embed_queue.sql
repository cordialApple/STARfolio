CREATE TABLE IF NOT EXISTS embed_queue (
  experience_id TEXT PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
  enqueued_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (3);
