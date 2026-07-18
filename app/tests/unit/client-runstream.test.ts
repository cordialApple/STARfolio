import { describe, expect, it } from 'vitest'
import { runStream, type RunStreamCallbacks, type StreamJob } from '../../src/main/ai/client'
import type { AiTransport, StreamCallbacks, StreamRequest } from '../../src/main/ai/transport'

const job: StreamJob = { prompt: 'hi', model: 'claude-haiku-4-5', feature: 'test' }

function collect(): { cb: RunStreamCallbacks; tokens: string[]; done: number; errors: string[] } {
  const tokens: string[] = []
  const errors: string[] = []
  let done = 0
  return {
    tokens,
    errors,
    get done() {
      return done
    },
    cb: {
      onToken: (t) => tokens.push(t),
      onDone: () => {
        done += 1
      },
      onError: (m) => errors.push(m)
    }
  }
}

function transportOf(impl: AiTransport['stream']): AiTransport {
  return { stream: impl }
}

describe('runStream', () => {
  it('forwards tokens then signals done after the transport completes', async () => {
    let seen: StreamRequest | undefined
    const transport = transportOf(async (req, _signal, cb) => {
      seen = req
      cb.onToken('a')
      cb.onToken('b')
      cb.onDone({ in: 1, out: 2, cacheRead: 0 })
    })
    const c = collect()
    await runStream(transport, { ...job, system: 'sys', maxTokens: 64 }, new AbortController().signal, c.cb)

    expect(c.tokens).toEqual(['a', 'b'])
    expect(c.done).toBe(1)
    expect(c.errors).toEqual([])
    expect(seen).toEqual({ model: job.model, prompt: 'hi', system: 'sys', maxTokens: 64 })
  })

  it('routes a transport-emitted error to onError, not onDone', async () => {
    const transport = transportOf(async (_req, _signal, cb: StreamCallbacks) => {
      cb.onError('stream blew up')
    })
    const c = collect()
    await runStream(transport, job, new AbortController().signal, c.cb)

    expect(c.errors).toEqual(['stream blew up'])
    expect(c.done).toBe(0)
  })

  it('funnels a rejected transport.stream through onError with the error message', async () => {
    const transport = transportOf(async () => {
      throw new Error('rejected outright')
    })
    const c = collect()
    await runStream(transport, job, new AbortController().signal, c.cb)

    expect(c.errors).toEqual(['rejected outright'])
    expect(c.done).toBe(0)
  })
})
