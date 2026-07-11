import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { loadVecExtension, runMigrations } from './migrate'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) throw new Error('DB not initialized — call initDb() first')
  return _db
}

export function initDb(dbPath?: string): Database.Database {
  const target = dbPath ?? join(app.getPath('userData'), 'superstar.db')
  const db = new Database(target)

  loadVecExtension(db)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db, target)

  _db = db
  return db
}

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
