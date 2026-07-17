import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubTransport, type AiTransport, type StreamUsage } from '../transport'
import { composeUtteranceStream, type ConversationInput } from './conversation'
import type { UtterancePartial } from '../utterance'

const USAGE: StreamUsage = { in: 1, out: 1, cacheRead: 0 }
const askIntro: ConversationInput = { action: { kind: 'ask_intro' } }

function scriptedTransport(tokens: string[]): AiTransport {
  return {
    async stream(_req, signal, cb): Promise<void> {
      for (const t of tokens) {
        if (signal.aborted) return
        cb.onToken(t)
      }
      cb.onDone(USAGE)
    }
  }
}

function failingTransport(message: string): AiTransport {
  return {
    async stream(_req, _signal, cb): Promise<void> {
      cb.onError(message)
    }
  }
}

describe('composeUtteranceStream', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('returns the trimmed concatenation of streamed tokens', async () => {
    const out = await composeUtteranceStream(askIntro, {
      transport: scriptedTransport(['Tell ', 'me ', 'about ', 'yourself.'])
    })
    expect(out).toBe('Tell me about yourself.')
  })

  it('trims leading and trailing whitespace, keeps interior (parse-path contract)', async () => {
    const tokens = ['  ', 'So,', ' what', ' broke?', ' ']
    const out = await composeUtteranceStream(askIntro, { transport: scriptedTransport(tokens) })
    expect(out).toBe(tokens.join('').trim())
  })

  it('emits incremental partials, sealing done=true on the final snapshot', async () => {
    const partials: UtterancePartial[] = []
    const out = await composeUtteranceStream(askIntro, {
      transport: scriptedTransport(['Walk ', 'me ', 'through ', 'it.']),
      onPartial: (p) => partials.push(p)
    })
    expect(partials.map((p) => p.text)).toEqual([
      'Walk',
      'Walk me',
      'Walk me through',
      'Walk me through it.',
      'Walk me through it.'
    ])
    expect(partials.slice(0, -1).every((p) => !p.done)).toBe(true)
    const last = partials[partials.length - 1]
    expect(last.done).toBe(true)
    expect(last.text).toBe(out)
  })

  it('works with the deterministic stubTransport seam', async () => {
    const out = await composeUtteranceStream(askIntro, { transport: stubTransport() })
    expect(out.startsWith('stub reply to:')).toBe(true)
    expect(out).toContain('ask_intro')
  })

  it('rejects when the transport reports an error', async () => {
    await expect(
      composeUtteranceStream(askIntro, { transport: failingTransport('boom') })
    ).rejects.toThrow('boom')
  })

  it('rejects an empty (whitespace-only) utterance to preserve the min-1 contract', async () => {
    await expect(
      composeUtteranceStream(askIntro, { transport: scriptedTransport(['   ', '\n']) })
    ).rejects.toThrow('empty utterance')
  })

  it('rejects when the signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(
      composeUtteranceStream(askIntro, {
        transport: scriptedTransport(['ignored']),
        signal: ac.signal
      })
    ).rejects.toThrow('aborted')
  })

  it('honors the STARFOLIO_AI_STUB path without touching the transport', async () => {
    vi.stubEnv('STARFOLIO_AI_STUB', '1')
    const partials: UtterancePartial[] = []
    let touched = false
    const spyTransport: AiTransport = {
      async stream(): Promise<void> {
        touched = true
      }
    }
    const out = await composeUtteranceStream(askIntro, {
      transport: spyTransport,
      onPartial: (p) => partials.push(p)
    })
    expect(touched).toBe(false)
    expect(out.length).toBeGreaterThan(0)
    expect(partials).toEqual([{ text: out, done: true }])
  })
})
