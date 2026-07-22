import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { initDb } from '../../src/main/db/client'
import { anthropicStructured } from '../../src/main/ai/roles/parse'

beforeEach(() => initDb(':memory:'))

describe('anthropicStructured', () => {
  it('throws when no anthropic api key is configured', async () => {
    await expect(
      anthropicStructured.parse({
        model: 'claude-haiku-4-5',
        system: 'sys',
        userText: 'hi',
        schema: z.object({ name: z.string() }),
        maxTokens: 2048
      })
    ).rejects.toThrow('No Anthropic API key configured')
  })
})
