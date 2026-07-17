import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIRST_TOKEN_TIMEOUT_MS,
  intervalStallTimer,
  STALL_CHECK_MS,
  STALL_TIMEOUT_MS
} from './watchdog'

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
