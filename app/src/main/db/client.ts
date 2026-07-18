import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { loadVecExtension, runMigrations } from './migrate'

let _db: Database.Database | null = null
let _dbPath: string | null = null

export function getDb(): Database.Database {
  if (!_db) throw new Error('DB not initialized — call initDb() first')
  return _db
}

export function getDbPath(): string {
  if (!_dbPath) throw new Error('DB not initialized — call initDb() first')
  return _dbPath
}

export function initDb(dbPath?: string): Database.Database {
  const target = dbPath ?? join(app.getPath('userData'), 'superstar.db')
  const db = new Database(target)

  loadVecExtension(db)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  runMigrations(db, target)

  _db = db
  _dbPath = target
  return db
}
