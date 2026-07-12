CREATE TABLE IF NOT EXISTS entities (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  meta_json  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, name)
);

CREATE TABLE IF NOT EXISTS edges (
  id        TEXT PRIMARY KEY,
  src_kind  TEXT NOT NULL,
  src_id    TEXT NOT NULL,
  rel       TEXT NOT NULL,
  dst_kind  TEXT NOT NULL,
  dst_id    TEXT NOT NULL,
  meta_json TEXT,
  UNIQUE (src_kind, src_id, rel, dst_kind, dst_id)
);

CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities (kind);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges (src_kind, src_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges (dst_kind, dst_id);
