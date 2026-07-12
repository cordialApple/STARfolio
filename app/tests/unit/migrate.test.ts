import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runMigrations, loadVecExtension, MIGRATIONS } from '../../src/main/db/migrate'

let dir: string
let dbPath: string

function open(): Database.Database {
  const db = new Database(dbPath)
  loadVecExtension(db)
  db.pragma('journal_mode = WAL')
  return db
}

function versions(db: Database.Database): number[] {
  return (
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: number
    }[]
  ).map((r) => r.version)
}

const bakCount = (): number => readdirSync(dir).filter((f) => f.endsWith('.bak')).length

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'star-migrate-'))
  dbPath = join(dir, 't.db')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('runMigrations', () => {
  it('applies every migration on a fresh DB and makes no backup', () => {
    const db = open()
    runMigrations(db, dbPath)
    expect(versions(db)).toEqual(MIGRATIONS.map((m) => m.version))
    expect(bakCount()).toBe(0)
    db.close()
  })

  it('is idempotent — a second run changes nothing and makes no backup', () => {
    let db = open()
    runMigrations(db, dbPath)
    db.close()
    db = open()
    runMigrations(db, dbPath)
    expect(versions(db)).toEqual(MIGRATIONS.map((m) => m.version))
    expect(bakCount()).toBe(0)
    db.close()
  })

  it('backs up before applying a migration to an existing schema', () => {
    const db = open()
    db.exec(MIGRATIONS[0].sql) // pre-apply v1 (self-records version 1)
    runMigrations(db, dbPath) // applied={1}, pending=[2..] → one backup, then the rest
    expect(versions(db)).toEqual(MIGRATIONS.map((m) => m.version))
    expect(bakCount()).toBe(1)
    db.close()
  })
})
