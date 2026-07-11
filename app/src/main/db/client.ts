import Database from 'better-sqlite3'
import { getLoadablePath } from 'sqlite-vec'
import { app } from 'electron'
import { join, sep } from 'path'
import { copyFileSync, existsSync } from 'fs'
import sql001 from './migrations/001_initial.sql?raw'
import sql002 from './migrations/002_vec_tables.sql?raw'

let _db: Database.Database | null = null

const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 1, sql: sql001 },
  { version: 2, sql: sql002 }
]

export function getDb(): Database.Database {
  if (!_db) throw new Error('DB not initialized — call initDb() first')
  return _db
}

export function loadVecExtension(db: Database.Database): void {
  const loadablePath = getLoadablePath().replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
  db.loadExtension(loadablePath)
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

function runMigrations(db: Database.Database, dbPath: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version
    )
  )

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    backupDb(dbPath)
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(m.version)
    })()
  }
}

function backupDb(dbPath: string): void {
  if (dbPath === ':memory:' || !existsSync(dbPath)) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(dbPath, `${dbPath}.${stamp}.bak`)
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
      .prepare(
        'SELECT experience_id FROM vec_experiences WHERE embedding MATCH ? AND k = 3'
      )
      .all(vec) as unknown[]
  ).length

  db.prepare('DELETE FROM experiences WHERE id = ?').run(id)
  db.prepare('DELETE FROM vec_experiences WHERE experience_id = ?').run(id)

  return { ok: fts > 0 && knn > 0, fts, knn }
}
