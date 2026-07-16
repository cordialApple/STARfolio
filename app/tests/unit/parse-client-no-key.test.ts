import { beforeEach, describe, expect, it } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { getParseClient } from '../../src/main/ai/roles/parse'

beforeEach(() => initDb(':memory:'))

describe('getParseClient', () => {
  it('throws when no anthropic api key is configured', () => {
    expect(() => getParseClient()).toThrow('No Anthropic API key configured')
  })
})
