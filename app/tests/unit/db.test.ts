import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { readFileSync } from 'fs'
import { join } from 'path'

function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  sqliteVec.load(db)
  db.pragma('foreign_keys = ON')

  const sql001 = readFileSync(
    join(__dirname, '../../src/main/db/migrations/001_initial.sql'),
    'utf8'
  )
  const sql002 = readFileSync(
    join(__dirname, '../../src/main/db/migrations/002_vec_tables.sql'),
    'utf8'
  )
  db.exec(sql001)
  db.exec(sql002)
  return db
}

describe('DB migrations', () => {
  let db: Database.Database

  beforeEach(() => {
    db = openTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('applies both migrations', () => {
    const versions = (
      db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
        version: number
      }[]
    ).map((r) => r.version)
    expect(versions).toEqual([1, 2])
  })

  it('FTS5 table exists', () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiences_fts'")
      .get()
    expect(row).toBeTruthy()
  })

  it('vec_experiences table exists', () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_experiences'")
      .get()
    expect(row).toBeTruthy()
  })

  it('FTS5 insert/search works', () => {
    const id = 'exp-001'
    db.prepare(
      `INSERT INTO experiences (id, title, action) VALUES (?, ?, ?)`
    ).run(id, 'Led migration', 'rewrote pipeline')

    const results = db
      .prepare(`SELECT rowid FROM experiences_fts WHERE experiences_fts MATCH 'pipeline'`)
      .all()
    expect(results.length).toBe(1)
  })

  it('vec_experiences insert/KNN works', () => {
    const dim = 384
    const vec = new Float32Array(dim).fill(0.1)

    db.prepare(`INSERT INTO vec_experiences (experience_id, embedding) VALUES (?, ?)`).run(
      'exp-001',
      vec
    )

    const rows = db
      .prepare(
        `SELECT experience_id, distance FROM vec_experiences WHERE embedding MATCH ? AND k = 5`
      )
      .all(vec) as { experience_id: string; distance: number }[]

    expect(rows.length).toBe(1)
    expect(rows[0].experience_id).toBe('exp-001')
  })
})
