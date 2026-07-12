CREATE TABLE IF NOT EXISTS corpus_embed_queue (
  chunk_id    TEXT PRIMARY KEY REFERENCES corpus_chunks(id) ON DELETE CASCADE,
  enqueued_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS practice_turn_corpus_chunks (
  turn_id  TEXT NOT NULL REFERENCES practice_turns(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES corpus_chunks(id) ON DELETE CASCADE,
  PRIMARY KEY (turn_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_corpus_chunks_doc ON corpus_chunks (doc_id);
