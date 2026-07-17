import { afterEach, describe, expect, it } from 'vitest'
import { SteeringLoop } from './loop'
import {
  clearSteeringLoop,
  registerSteeringLoop,
  steeringLoopFor,
  steeringSignalFor
} from './registry'
import type { AnswerEvaluation } from '../roadmap'

const evalWith = (skill: number): AnswerEvaluation => ({
  topicId: null,
  coverageDeltas: {},
  candidateDelta: { demonstratedSkill: skill },
  newThreads: [],
  resolvedThreadIds: []
})

async function loopWithSignalAt(at: number): Promise<SteeringLoop> {
  const loop = new SteeringLoop({
    view: () => ({ text: 'live answer' }),
    evaluate: async () => evalWith(0.5)
  })
  await loop.run(at)
  return loop
}

const SID = 'session-1'

afterEach(() => clearSteeringLoop(SID))

describe('steering registry', () => {
  it('returns null when no loop is registered', () => {
    expect(steeringSignalFor(SID, 1000, 20_000)).toBeNull()
  })

  it('returns a signal committed within the freshness window', async () => {
    registerSteeringLoop(SID, await loopWithSignalAt(1000))
    expect(steeringSignalFor(SID, 5000, 20_000)?.evaluation).toEqual(evalWith(0.5))
  })

  it('returns the signal exactly at the freshness boundary', async () => {
    registerSteeringLoop(SID, await loopWithSignalAt(1000))
    expect(steeringSignalFor(SID, 21_000, 20_000)).not.toBeNull()
  })

  it('rejects a signal older than the freshness window', async () => {
    registerSteeringLoop(SID, await loopWithSignalAt(1000))
    expect(steeringSignalFor(SID, 21_001, 20_000)).toBeNull()
  })

  it('returns null once the loop is cleared', async () => {
    registerSteeringLoop(SID, await loopWithSignalAt(1000))
    clearSteeringLoop(SID)
    expect(steeringSignalFor(SID, 1000, 20_000)).toBeNull()
    expect(steeringLoopFor(SID)).toBeUndefined()
  })

  it('returns null when the registered loop has no signal yet', () => {
    registerSteeringLoop(SID, new SteeringLoop({ view: () => ({ text: '' }), evaluate: async () => evalWith(0) }))
    expect(steeringSignalFor(SID, 1000, 20_000)).toBeNull()
  })

  it('overwrites an earlier registration for the same session', async () => {
    registerSteeringLoop(SID, await loopWithSignalAt(1000))
    const loop2 = new SteeringLoop({
      view: () => ({ text: 'second' }),
      evaluate: async () => evalWith(0.9)
    })
    await loop2.run(2000)
    registerSteeringLoop(SID, loop2)
    expect(steeringSignalFor(SID, 2000, 20_000)?.evaluation).toEqual(evalWith(0.9))
  })
})
