import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { parseStructured, type ParseClient } from '../../src/main/ai/roles/parse'

const schema = z.object({ name: z.string() })

interface FakeResult {
  stop_reason: string | null
  parsed_output?: unknown
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }
}

function fakeClient(result: FakeResult): { client: ParseClient; parse: ReturnType<typeof vi.fn> } {
  const parse = vi.fn(async () => ({
    usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0 },
    ...result
  }))
  return { client: { messages: { parse } } as unknown as ParseClient, parse }
}

const base = { model: 'claude-haiku-4-5', system: 'sys', userText: 'hi', schema, feature: 'test' }

describe('parseStructured', () => {
  it('returns the schema-validated output on success', async () => {
    const { client } = fakeClient({ stop_reason: 'end_turn', parsed_output: { name: 'Ada' } })
    await expect(parseStructured({ ...base, client })).resolves.toEqual({ name: 'Ada' })
  })

  it('throws a friendly error on refusal', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal' })
    await expect(parseStructured({ ...base, client })).rejects.toThrow('The model declined to respond')
  })

  it('surfaces the stop_reason when no structured output comes back', async () => {
    const { client } = fakeClient({ stop_reason: 'max_tokens' })
    await expect(parseStructured({ ...base, client })).rejects.toThrow('stop_reason: max_tokens')
  })

  it('re-validates the parsed output against the schema', async () => {
    const { client } = fakeClient({ stop_reason: 'end_turn', parsed_output: { name: 123 } })
    await expect(parseStructured({ ...base, client })).rejects.toThrow()
  })

  it('defaults max_tokens to 2048 and honors an override', async () => {
    const a = fakeClient({ stop_reason: 'end_turn', parsed_output: { name: 'x' } })
    await parseStructured({ ...base, client: a.client })
    expect(a.parse.mock.calls[0][0].max_tokens).toBe(2048)

    const b = fakeClient({ stop_reason: 'end_turn', parsed_output: { name: 'x' } })
    await parseStructured({ ...base, client: b.client, maxTokens: 512 })
    expect(b.parse.mock.calls[0][0].max_tokens).toBe(512)
  })
})
