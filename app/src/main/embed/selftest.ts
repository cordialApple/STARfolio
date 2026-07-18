import { getDb } from '../db/client'
import { embed } from './index'

export async function embedSelfTest(): Promise<{ ok: boolean; dims: number; knn: number }> {
  const vector = await embed('a time I led a project under pressure')
  const db = getDb()
  const id = `embed-selftest-${Date.now()}`
  db.prepare('INSERT INTO experiences (id, title) VALUES (?, ?)').run(id, 'Embed self test')
  db.prepare(
    'INSERT OR REPLACE INTO vec_experiences (experience_id, embedding) VALUES (?, ?)'
  ).run(id, vector)
  const knn = (
    db
      .prepare('SELECT experience_id FROM vec_experiences WHERE embedding MATCH ? AND k = 3')
      .all(vector) as unknown[]
  ).length
  db.prepare('DELETE FROM experiences WHERE id = ?').run(id)
  db.prepare('DELETE FROM vec_experiences WHERE experience_id = ?').run(id)
  return { ok: vector.length === 384 && knn > 0, dims: vector.length, knn }
}
