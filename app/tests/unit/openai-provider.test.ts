import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { openaiStructured, openaiTransport } from '../../src/main/ai/providers/openai'
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

describe('openaiStructured', () => {
  it('posts a json_schema response_format and maps the completion + usage', async () => {
    const { fetch, calls } = jsonFetch({
      choices: [{ message: { content: '{"answer":"42"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 4 } }
    })
    const provider = openaiStructured({ baseUrl: 'http://localhost:11434/v1/', apiKey: 'k', fetch })
    const out = await provider.parse({ model: 'llama', system: 's', userText: 'u', schema, maxTokens: 256 })

    expect(out.parsed_output).toEqual({ answer: '42' })
    expect(out.stop_reason).toBe('stop')
    expect(out.usage).toEqual({ input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 4 })

    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions')
    const sent = JSON.parse(calls[0].init.body as string)
    expect(sent.response_format.type).toBe('json_schema')
    expect(sent.response_format.json_schema.schema.properties.answer).toBeTruthy()
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer k')
  })

  it('falls back to json_object mode and folds the schema into the system prompt', async () => {
    const { fetch, calls } = jsonFetch({
      choices: [{ message: { content: '{"answer":"7"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2 }
    })
    const out = await openaiStructured({
      baseUrl: 'http://x/v1',
      apiKey: 'k',
      fetch,
      structuredMode: 'json_object'
    }).parse({ model: 'm', system: 'be terse', userText: 'u', schema, maxTokens: 10 })

    expect(out.parsed_output).toEqual({ answer: '7' })
    const sent = JSON.parse(calls[0].init.body as string)
    expect(sent.response_format).toEqual({ type: 'json_object' })
    expect(sent.messages[0].content).toContain('be terse')
    expect(sent.messages[0].content).toContain('"answer"')
  })

  it('surfaces a refusal as stop_reason refusal with no parsed output', async () => {
    const { fetch } = jsonFetch({
      choices: [{ message: { refusal: 'no' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 0 }
    })
    const out = await openaiStructured({ baseUrl: 'http://x/v1', apiKey: 'k', fetch }).parse({
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
      openaiStructured({ baseUrl: 'http://x/v1', apiKey: 'k', fetch }).parse({
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
      openaiStructured({ baseUrl: 'http://x/v1', apiKey: '' }).parse({
        model: 'm',
        system: 's',
        userText: 'u',
        schema,
        maxTokens: 10
      })
    ).rejects.toThrow('No OpenAI API key configured')
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

describe('openaiTransport', () => {
  it('streams delta tokens and reports the final usage chunk', async () => {
    const fetch = sseFetch([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":1}}}\n',
      'data: [DONE]\n'
    ])
    const tokens: string[] = []
    let usage: { in: number; out: number; cacheRead: number } | undefined
    await openaiTransport({ baseUrl: 'http://x/v1', apiKey: 'k', fetch }).stream(
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
    await openaiTransport({ baseUrl: 'http://x/v1', apiKey: 'k', fetch }).stream(
      { model: 'm', prompt: 'hi' },
      new AbortController().signal,
      { onToken: () => {}, onDone: () => {}, onError: (m) => (err = m) }
    )
    expect(err).toMatch(/failed \(502\)/)
  })
})
