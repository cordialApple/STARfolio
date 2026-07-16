import { describe, expect, it } from 'vitest'
import { getDbPath, initDb } from '../../src/main/db/client'

describe('getDbPath guard', () => {
  it('throws before init, then returns the active path', () => {
    expect(() => getDbPath()).toThrow('DB not initialized')
    initDb(':memory:')
    expect(getDbPath()).toBe(':memory:')
  })
})
