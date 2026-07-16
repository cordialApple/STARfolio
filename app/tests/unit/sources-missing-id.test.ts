import { beforeEach, describe, expect, it } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { getSource } from '../../src/main/db/repositories/sources'

beforeEach(() => initDb(':memory:'))

describe('getSource missing id', () => {
  it('returns null when no source has the id', () => {
    expect(getSource('ghost-id')).toBeNull()
  })
})
