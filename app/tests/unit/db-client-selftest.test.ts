import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { dbSelfTest, getDb, getDbPath, initDb } from '../../src/main/db/client'

let dir: string | null = null
afterEach(() => {
  try {
    getDb().close()
  } catch {
    // DB may not be open; nothing to close
  }
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('getDbPath', () => {
  it('reports the path an in-memory DB was opened at', () => {
    initDb(':memory:')
    expect(getDbPath()).toBe(':memory:')
  })

  it('reports a file path when opened on disk', () => {
    dir = mkdtempSync(join(tmpdir(), 'starfolio-dbpath-'))
    const path = join(dir, 'bank.db')
    initDb(path)
    expect(getDbPath()).toBe(path)
    expect(getDb().open).toBe(true)
  })
})

describe('dbSelfTest', () => {
  it('proves fts5 and sqlite-vec are both live and leaves no probe row behind', () => {
    initDb(':memory:')
    const before = (getDb().prepare('SELECT COUNT(*) c FROM experiences').get() as { c: number }).c
    const res = dbSelfTest()
    expect(res.ok).toBe(true)
    expect(res.fts).toBeGreaterThan(0)
    expect(res.knn).toBeGreaterThan(0)
    const after = (getDb().prepare('SELECT COUNT(*) c FROM experiences').get() as { c: number }).c
    expect(after).toBe(before)
  })
})
