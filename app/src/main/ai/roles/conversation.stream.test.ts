import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubTransport, type AiTransport, type StreamUsage } from '../transport'
import { composeUtteranceStream, type ConversationInput } from './conversation'
import {
  FIRST_TOKEN_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  type StallTimer,
  type UtterancePartial
} from '../utterance'

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

function manualTimer(): StallTimer & { fire: () => void } {
  let onCheck: (() => void) | undefined
  return {
    start: (cb) => (onCheck = cb),
    stop: () => (onCheck = undefined),
    fire: () => onCheck?.()
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

  it('aborts and rejects with a stall error when the stream idles past the threshold', async () => {
    const clock = { t: 0 }
    const timer = manualTimer()
    const partials: UtterancePartial[] = []
    const stallingTransport: AiTransport = {
      async stream(_req, signal, cb): Promise<void> {
        cb.onToken('Half a question')
        clock.t += STALL_TIMEOUT_MS + 1
        timer.fire()
        if (signal.aborted) return
        cb.onDone(USAGE)
      }
    }
    await expect(
      composeUtteranceStream(askIntro, {
        transport: stallingTransport,
        stallTimer: timer,
        now: () => clock.t,
        onPartial: (p) => partials.push(p)
      })
    ).rejects.toThrow('stalled')
    expect(partials.at(-1)?.done).toBe(false)
  })

  it('aborts and rejects when no first token arrives before the TTFT deadline', async () => {
    const clock = { t: 0 }
    const timer = manualTimer()
    const partials: UtterancePartial[] = []
    const silentTransport: AiTransport = {
      async stream(_req, signal, cb): Promise<void> {
        clock.t += FIRST_TOKEN_TIMEOUT_MS + 1
        timer.fire()
        if (signal.aborted) return
        cb.onToken('too late')
        cb.onDone(USAGE)
      }
    }
    await expect(
      composeUtteranceStream(askIntro, {
        transport: silentTransport,
        stallTimer: timer,
        now: () => clock.t,
        onPartial: (p) => partials.push(p)
      })
    ).rejects.toThrow('never started')
    expect(partials).toEqual([])
  })

  it('does not trip the TTFT guard when the first token arrives before the deadline', async () => {
    const clock = { t: 0 }
    const timer = manualTimer()
    const promptTransport: AiTransport = {
      async stream(_req, _signal, cb): Promise<void> {
        clock.t += FIRST_TOKEN_TIMEOUT_MS - 1
        cb.onToken('Right ')
        timer.fire()
        cb.onToken('on time.')
        cb.onDone(USAGE)
      }
    }
    const out = await composeUtteranceStream(askIntro, {
      transport: promptTransport,
      stallTimer: timer,
      now: () => clock.t
    })
    expect(out).toBe('Right on time.')
  })

  it('does not stall a live stream whose idle stays under the threshold', async () => {
    const clock = { t: 0 }
    const timer = manualTimer()
    const liveTransport: AiTransport = {
      async stream(_req, _signal, cb): Promise<void> {
        cb.onToken('Tell ')
        clock.t += 100
        timer.fire()
        cb.onToken('me more.')
        cb.onDone(USAGE)
      }
    }
    const out = await composeUtteranceStream(askIntro, {
      transport: liveTransport,
      stallTimer: timer,
      now: () => clock.t
    })
    expect(out).toBe('Tell me more.')
  })

  it('surfaces a caller abort as an abort error, distinct from a stall', async () => {
    const ac = new AbortController()
    const timer = manualTimer()
    const cancelTransport: AiTransport = {
      async stream(_req, signal, cb): Promise<void> {
        cb.onToken('Half')
        ac.abort()
        if (signal.aborted) return
        cb.onDone(USAGE)
      }
    }
    await expect(
      composeUtteranceStream(askIntro, {
        transport: cancelTransport,
        stallTimer: timer,
        signal: ac.signal
      })
    ).rejects.toThrow('composeUtteranceStream aborted')
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
