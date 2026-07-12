import type Database from 'better-sqlite3'
import { getLoadablePath } from 'sqlite-vec'
import { sep } from 'path'
import { copyFileSync, existsSync } from 'fs'
import sql001 from './migrations/001_initial.sql?raw'
import sql002 from './migrations/002_vec_tables.sql?raw'
import sql003 from './migrations/003_embed_queue.sql?raw'
import sql004 from './migrations/004_source_indexes.sql?raw'
import sql005 from './migrations/005_entities_edges.sql?raw'
import sql006 from './migrations/006_corpus_practice.sql?raw'

export const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 1, sql: sql001 },
  { version: 2, sql: sql002 },
  { version: 3, sql: sql003 },
  { version: 4, sql: sql004 },
  { version: 5, sql: sql005 },
  { version: 6, sql: sql006 }
]

export function loadVecExtension(db: Database.Database): void {
  const loadablePath = getLoadablePath().replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
  if (!existsSync(loadablePath)) {
    throw new Error(`sqlite-vec extension not found at ${loadablePath} (asar-unpack misconfigured?)`)
  }
  db.loadExtension(loadablePath)
}

function backupDb(db: Database.Database, dbPath: string): void {
  if (dbPath === ':memory:' || !existsSync(dbPath)) return
  // Fold the WAL back into the main file first, so the copied snapshot is complete.
  db.pragma('wal_checkpoint(TRUNCATE)')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(dbPath, `${dbPath}.${stamp}.bak`)
}

export function runMigrations(db: Database.Database, dbPath: string): void {
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

  const pending = MIGRATIONS.filter((m) => !applied.has(m.version))
  // Back up once before touching an existing schema; a brand-new DB has nothing to protect.
  if (pending.length > 0 && applied.size > 0) backupDb(db, dbPath)

  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(m.version)
    })()
  }
}
