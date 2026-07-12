import { describe, it, expect } from 'vitest'
import { stubTransport, type StreamUsage } from '../../src/main/ai/transport'

function recorder(): {
  tokens: string[]
  done: boolean
  error: string | null
  usage: StreamUsage | null
  onToken: (t: string) => void
  onDone: (u: StreamUsage) => void
  onError: (m: string) => void
} {
  const rec = {
    tokens: [] as string[],
    done: false,
    error: null as string | null,
    usage: null as StreamUsage | null,
    onToken: (t: string): void => {
      rec.tokens.push(t)
    },
    onDone: (u: StreamUsage): void => {
      rec.done = true
      rec.usage = u
    },
    onError: (m: string): void => {
      rec.error = m
    }
  }
  return rec
}

describe('AI stub transport', () => {
  it('streams tokens then completes with usage', async () => {
    const rec = recorder()
    await stubTransport().stream(
      { model: 'haiku-test', prompt: 'hello world' },
      new AbortController().signal,
      rec
    )
    expect(rec.tokens.join('')).toContain('stub reply to: hello world')
    expect(rec.done).toBe(true)
    expect(rec.error).toBeNull()
    expect(rec.usage?.out).toBeGreaterThan(0)
  })

  it('stops emitting when aborted', async () => {
    const rec = recorder()
    const ac = new AbortController()
    ac.abort()
    await stubTransport().stream({ model: 'stub', prompt: 'never streamed' }, ac.signal, rec)
    expect(rec.tokens.length).toBe(0)
    expect(rec.done).toBe(false)
  })
})
