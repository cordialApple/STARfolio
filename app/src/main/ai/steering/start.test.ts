import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startSteeringLoop } from './start'
import { SteeringRegistry } from './registry'
import type { AnswerEvaluation } from '../roadmap'

const evalWith = (skill: number): AnswerEvaluation => ({
  topicId: null,
  coverageDeltas: {},
  candidateDelta: { demonstratedSkill: skill },
  newThreads: [],
  resolvedThreadIds: []
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('startSteeringLoop', () => {
  it('registers the loop in the given registry', () => {
    const registry = new SteeringRegistry()
    const { loop, dispose } = startSteeringLoop({
      sessionId: 'S',
      cadence: 1000,
      registry,
      now: () => 0,
      view: () => ({ text: '' }),
      evaluate: async () => evalWith(0)
    })
    expect(registry.get('S')).toBe(loop)
    dispose()
  })

  it('evaluates the current view text on each cadence tick with the injected clock', async () => {
    const registry = new SteeringRegistry()
    const seen: string[] = []
    let clock = 5000
    const { loop, dispose } = startSteeringLoop({
      sessionId: 'S',
      cadence: 1000,
      registry,
      now: () => clock,
      view: () => ({ text: `answer ${clock}` }),
      evaluate: async (text) => {
        seen.push(text)
        return evalWith(0.5)
      }
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(seen).toEqual(['answer 5000'])
    expect(loop.latest()?.at).toBe(5000)

    clock = 6000
    await vi.advanceTimersByTimeAsync(1000)
    expect(seen).toEqual(['answer 5000', 'answer 6000'])
    expect(loop.latest()?.at).toBe(6000)

    dispose()
  })

  it('stops ticking and clears the registry on dispose', async () => {
    const registry = new SteeringRegistry()
    let calls = 0
    const { dispose } = startSteeringLoop({
      sessionId: 'S',
      cadence: 1000,
      registry,
      now: () => 0,
      view: () => ({ text: 'live' }),
      evaluate: async () => {
        calls += 1
        return evalWith(0)
      }
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toBe(1)

    dispose()
    expect(registry.get('S')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toBe(1)
  })

  it('swallows a rejected evaluate so the timer keeps running', async () => {
    const registry = new SteeringRegistry()
    let calls = 0
    const { dispose } = startSteeringLoop({
      sessionId: 'S',
      cadence: 1000,
      registry,
      now: () => calls,
      view: () => ({ text: `t${calls}` }),
      evaluate: async () => {
        calls += 1
        throw new Error('eval blew up')
      }
    })

    await vi.advanceTimersByTimeAsync(3000)
    expect(calls).toBe(3)

    dispose()
  })
})
