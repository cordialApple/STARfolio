import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { geminiStructured, geminiTransport, toGeminiSchema } from '../../src/main/ai/providers/gemini'
import type { Fetch } from '../../src/main/ai/fixtures'

const schema = z.object({ answer: z.string() })

function jsonFetch(body: unknown, status = 200): { fetch: Fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch: Fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { fetch, calls }
}

describe('toGeminiSchema', () => {
  it('uppercases types and prunes strict-hostile keywords', () => {
    const out = toGeminiSchema(
      z.object({
        score: z.number().int().min(1).max(5),
        tags: z.array(z.string()).max(20),
        note: z.string().nullable(),
        kind: z.enum(['a', 'b'])
      })
    ) as Record<string, unknown>
    expect(out.type).toBe('OBJECT')
    expect(out.additionalProperties).toBeUndefined()
    expect(out.$schema).toBeUndefined()
    const props = out.properties as Record<string, Record<string, unknown>>
    expect(props.score.type).toBe('INTEGER')
    expect(props.score.minimum).toBeUndefined()
    expect(props.score.maximum).toBeUndefined()
    expect(props.tags.type).toBe('ARRAY')
    expect(props.tags.maxItems).toBeUndefined()
    expect((props.tags.items as Record<string, unknown>).type).toBe('STRING')
    expect(props.note.type).toBe('STRING')
    expect(props.note.nullable).toBe(true)
    expect(props.kind.type).toBe('STRING')
    expect(props.kind.enum).toEqual(['a', 'b'])
  })
})

describe('geminiStructured', () => {
  it('posts a responseSchema and maps the candidate text + usage', async () => {
    const { fetch, calls } = jsonFetch({
      candidates: [{ content: { parts: [{ text: '{"answer":"42"}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, cachedContentTokenCount: 4 }
    })
    const out = await geminiStructured({ baseUrl: 'https://g/v1beta/', apiKey: 'k', fetch }).parse({
      model: 'gemini-x',
      system: 's',
      userText: 'u',
      schema,
      maxTokens: 256
    })
    expect(out.parsed_output).toEqual({ answer: '42' })
    expect(out.stop_reason).toBe('STOP')
    expect(out.usage).toEqual({ input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 4 })

    expect(calls[0].url).toBe('https://g/v1beta/models/gemini-x:generateContent')
    const sent = JSON.parse(calls[0].init.body as string)
    expect(sent.generationConfig.responseMimeType).toBe('application/json')
    expect(sent.generationConfig.responseSchema.type).toBe('OBJECT')
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
  })

  it('surfaces a SAFETY finish as stop_reason refusal with no parsed output', async () => {
    const { fetch } = jsonFetch({
      candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }],
      usageMetadata: { promptTokenCount: 3 }
    })
    const out = await geminiStructured({ baseUrl: 'https://g/v1beta', apiKey: 'k', fetch }).parse({
      model: 'm',
      system: 's',
      userText: 'u',
      schema,
      maxTokens: 10
    })
    expect(out.stop_reason).toBe('refusal')
    expect(out.parsed_output).toBeUndefined()
  })

  it('throws on a non-2xx response', async () => {
    const { fetch } = jsonFetch({}, 500)
    await expect(
      geminiStructured({ baseUrl: 'https://g/v1beta', apiKey: 'k', fetch }).parse({
        model: 'm',
        system: 's',
        userText: 'u',
        schema,
        maxTokens: 10
      })
    ).rejects.toThrow(/failed \(500\)/)
  })

  it('throws when the resolved key is empty', async () => {
    await expect(
      geminiStructured({ baseUrl: 'https://g/v1beta', apiKey: '' }).parse({
        model: 'm',
        system: 's',
        userText: 'u',
        schema,
        maxTokens: 10
      })
    ).rejects.toThrow('No Gemini API key configured')
  })
})

function sseFetch(chunks: string[]): Fetch {
  return async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        for (const c of chunks) controller.enqueue(enc.encode(c))
        controller.close()
      }
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
}

describe('geminiTransport', () => {
  it('streams delta tokens and reports the final usage chunk', async () => {
    const fetch = sseFetch([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\n',
      'data: {"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2,"cachedContentTokenCount":1}}\n'
    ])
    const tokens: string[] = []
    let usage: { in: number; out: number; cacheRead: number } | undefined
    await geminiTransport({ baseUrl: 'https://g/v1beta', apiKey: 'k', fetch }).stream(
      { model: 'm', prompt: 'hi' },
      new AbortController().signal,
      { onToken: (t) => tokens.push(t), onDone: (u) => (usage = u), onError: () => {} }
    )
    expect(tokens.join('')).toBe('Hello')
    expect(usage).toEqual({ in: 5, out: 2, cacheRead: 1 })
  })

  it('routes a transport error to onError', async () => {
    const fetch: Fetch = async () => new Response('nope', { status: 502 })
    let err = ''
    await geminiTransport({ baseUrl: 'https://g/v1beta', apiKey: 'k', fetch }).stream(
      { model: 'm', prompt: 'hi' },
      new AbortController().signal,
      { onToken: () => {}, onDone: () => {}, onError: (m) => (err = m) }
    )
    expect(err).toMatch(/failed \(502\)/)
  })
})
