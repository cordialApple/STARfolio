import { getDb } from './client'

export function dbSelfTest(): { ok: boolean; fts: number; knn: number } {
  const db = getDb()
  const id = `selftest-${Date.now()}`
  db.prepare('INSERT INTO experiences (id, title, action) VALUES (?, ?, ?)').run(
    id,
    'Self test',
    'verified sqlite-vec and fts5 in packaged app'
  )
  const fts = (
    db
      .prepare("SELECT rowid FROM experiences_fts WHERE experiences_fts MATCH 'packaged'")
      .all() as unknown[]
  ).length

  const vec = new Float32Array(384).fill(0.05)
  db.prepare('INSERT OR REPLACE INTO vec_experiences (experience_id, embedding) VALUES (?, ?)').run(
    id,
    vec
  )
  const knn = (
    db
      .prepare('SELECT experience_id FROM vec_experiences WHERE embedding MATCH ? AND k = 3')
      .all(vec) as unknown[]
  ).length

  db.prepare('DELETE FROM experiences WHERE id = ?').run(id)
  db.prepare('DELETE FROM vec_experiences WHERE experience_id = ?').run(id)

  return { ok: fts > 0 && knn > 0, fts, knn }
}
