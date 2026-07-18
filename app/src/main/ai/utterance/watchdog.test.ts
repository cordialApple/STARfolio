import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIRST_TOKEN_TIMEOUT_MS,
  intervalStallTimer,
  STALL_CHECK_MS,
  STALL_TIMEOUT_MS,
  streamWithWatchdog,
  type StallTimer
} from './watchdog'
import type { AiTransport, StreamCallbacks, StreamRequest, StreamUsage } from '../transport'

describe('watchdog constants', () => {
  it('checks more often than it times out, in a 15-20s stall window', () => {
    expect(STALL_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000)
    expect(STALL_TIMEOUT_MS).toBeLessThanOrEqual(20_000)
    expect(STALL_CHECK_MS).toBeLessThan(STALL_TIMEOUT_MS)
  })

  it('gives the first token a 10-12s window, tighter than a mid-stream stall', () => {
    expect(FIRST_TOKEN_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
    expect(FIRST_TOKEN_TIMEOUT_MS).toBeLessThanOrEqual(12_000)
    expect(FIRST_TOKEN_TIMEOUT_MS).toBeLessThan(STALL_TIMEOUT_MS)
    expect(STALL_CHECK_MS).toBeLessThan(FIRST_TOKEN_TIMEOUT_MS)
  })
})

describe('intervalStallTimer', () => {
  afterEach(() => vi.useRealTimers())

  it('fires onCheck each interval until stopped', () => {
    vi.useFakeTimers()
    let ticks = 0
    const timer = intervalStallTimer(1000)
    timer.start(() => (ticks += 1))
    vi.advanceTimersByTime(3000)
    expect(ticks).toBe(3)
    timer.stop()
    vi.advanceTimersByTime(3000)
    expect(ticks).toBe(3)
  })

  it('stop is idempotent before any start', () => {
    const timer = intervalStallTimer(1000)
    expect(() => timer.stop()).not.toThrow()
  })
})

describe('streamWithWatchdog', () => {
  const request: StreamRequest = { model: 'm', prompt: 'p', system: 's', maxTokens: 512 }
  const usage: StreamUsage = { in: 1, out: 1, cacheRead: 0 }

  class ManualTimer implements StallTimer {
    check?: () => void
    start(onCheck: () => void): void {
      this.check = onCheck
    }
    stop(): void {
      this.check = undefined
    }
  }

  function transport(script: (cb: StreamCallbacks, signal: AbortSignal) => void): AiTransport {
    return { stream: async (_req, signal, cb) => script(cb, signal) }
  }

  it('returns the assembled, trimmed text on the happy path', async () => {
    const partials: string[] = []
    let seen: StreamUsage | undefined
    const out = await streamWithWatchdog({
      transport: transport((cb) => {
        cb.onToken('Hello ')
        cb.onToken('world')
        cb.onDone(usage)
      }),
      request,
      now: () => 0,
      stallTimer: new ManualTimer(),
      onToken: (p) => partials.push(p.text),
      onDone: (u) => (seen = u)
    })
    expect(out).toBe('Hello world')
    expect(partials.at(-1)).toBe('Hello world')
    expect(seen).toEqual(usage)
  })

  it('throws the never-started error when no token arrives inside the first-token window', async () => {
    let nowMs = 0
    const timer = new ManualTimer()
    await expect(
      streamWithWatchdog({
        transport: transport(() => {
          nowMs += FIRST_TOKEN_TIMEOUT_MS
          timer.check?.()
        }),
        request,
        now: () => nowMs,
        stallTimer: timer
      })
    ).rejects.toThrow('The interviewer never started composing a reply')
  })

  it('throws the stalled error when the stream idles past the stall window', async () => {
    let nowMs = 0
    const timer = new ManualTimer()
    await expect(
      streamWithWatchdog({
        transport: transport((cb) => {
          cb.onToken('hi')
          nowMs += STALL_TIMEOUT_MS
          timer.check?.()
        }),
        request,
        now: () => nowMs,
        stallTimer: timer
      })
    ).rejects.toThrow('The interviewer stalled while composing a reply')
  })

  it('throws the aborted error when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      streamWithWatchdog({
        transport: transport(() => {}),
        request,
        signal: controller.signal,
        now: () => 0,
        stallTimer: new ManualTimer()
      })
    ).rejects.toThrow('composeUtteranceStream aborted')
  })

  it('throws the empty-utterance error when the stream completes with no text', async () => {
    await expect(
      streamWithWatchdog({
        transport: transport((cb) => cb.onDone(usage)),
        request,
        now: () => 0,
        stallTimer: new ManualTimer()
      })
    ).rejects.toThrow('The model produced an empty utterance')
  })

  it('passes a transport failure through verbatim', async () => {
    await expect(
      streamWithWatchdog({
        transport: transport((cb) => cb.onError('boom')),
        request,
        now: () => 0,
        stallTimer: new ManualTimer()
      })
    ).rejects.toThrow('boom')
  })
})
