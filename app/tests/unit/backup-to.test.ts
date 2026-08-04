import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDb, initDb } from '../../src/main/db/client'
import { backupTo } from '../../src/main/db/backup'
import { createExperience } from '../../src/main/db/repositories/experiences'

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

describe('backupTo', () => {
  it('copies the live file DB to the destination with all rows intact', () => {
    dir = mkdtempSync(join(tmpdir(), 'starfolio-backup-'))
    initDb(join(dir, 'live.db'))
    createExperience({ title: 'Backed this up' })

    const dest = join(dir, 'snapshot.db')
    expect(backupTo(dest)).toEqual({ path: dest })
    expect(existsSync(dest)).toBe(true)

    const copy = new Database(dest, { readonly: true })
    const row = copy.prepare('SELECT title FROM experiences').get() as { title: string }
    copy.close()
    expect(row.title).toBe('Backed this up')
  })

  it('writes a point-in-time snapshot that later edits do not mutate', () => {
    dir = mkdtempSync(join(tmpdir(), 'starfolio-backup-'))
    initDb(join(dir, 'live.db'))
    createExperience({ title: 'before snapshot' })

    const dest = join(dir, 'snapshot.db')
    backupTo(dest)
    createExperience({ title: 'after snapshot' })

    const copy = new Database(dest, { readonly: true })
    const count = (copy.prepare('SELECT COUNT(*) c FROM experiences').get() as { c: number }).c
    copy.close()
    expect(count).toBe(1)
  })
})
