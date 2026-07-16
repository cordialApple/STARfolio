import { app } from 'electron'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDbPath, initDb } from '../../src/main/db/client'

let dir: string

afterEach(() => {
  vi.restoreAllMocks()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('initDb default path', () => {
  it('derives the db file under the app userData dir when no path is given', () => {
    dir = mkdtempSync(join(tmpdir(), 'db-client-'))
    vi.spyOn(app, 'getPath').mockReturnValue(dir)

    const db = initDb()
    try {
      const expected = join(dir, 'superstar.db')
      expect(getDbPath()).toBe(expected)
      expect(existsSync(expected)).toBe(true)
    } finally {
      db.close()
    }
  })
})
