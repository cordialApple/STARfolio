CREATE VIRTUAL TABLE IF NOT EXISTS vec_experiences USING vec0(
  experience_id TEXT PRIMARY KEY,
  embedding     float[384]
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_corpus USING vec0(
  chunk_id  TEXT PRIMARY KEY,
  embedding float[384]
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
