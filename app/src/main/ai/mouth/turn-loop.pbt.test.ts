import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { runProperty } from '../../voice/pbt/pbt'
import { cascadeMouth } from './cascade'
import { conformsToSeam } from './conformance'
import { TurnLoop, stubPhraser, type TtsMouthSink, type TurnBrain } from './turn-loop'
import { planArb } from './pbt/arbitraries'
import type { DirectedAction } from '../roadmap'

const GUARD_MS = 250

class FakeTts implements TtsMouthSink {
  readonly spoken: string[] = []
  readonly events: Array<{ type: 'speak'; text: string } | { type: 'finish'; marker: number }> = []
  private seq = 0
  speak(text: string): void {
    this.spoken.push(text)
    this.events.push({ type: 'speak', text })
  }
  finish(): number {
    const marker = this.seq++
    this.events.push({ type: 'finish', marker })
    return marker
  }
}

class QueueBrain implements TurnBrain {
  private i = 0
  constructor(private readonly plans: DirectedAction[][]) {}
  plan(): DirectedAction[] {
    return this.plans[this.i++] ?? []
  }
}

class Clock {
  constructor(public t = 0) {}
  now = (): number => this.t
}

function build(plans: DirectedAction[][], clock = new Clock()): { loop: TurnLoop; tts: FakeTts; clock: Clock } {
  const tts = new FakeTts()
  const loop = new TurnLoop({
    brain: new QueueBrain(plans),
    mouth: cascadeMouth,
    phraser: stubPhraser,
    tts,
    halfDuplex: { guardMs: GUARD_MS },
    now: clock.now
  })
  return { loop, tts, clock }
}

type Op = { op: 'eot' } | { op: 'tick'; dt: number } | { op: 'end' }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.constant<Op>({ op: 'eot' }),
  fc.record({ op: fc.constant<'tick'>('tick'), dt: fc.integer({ min: 0, max: 400 }) }),
  fc.constant<Op>({ op: 'end' })
)

const scheduleArb = fc.record({
  plans: fc.array(planArb, { minLength: 1, maxLength: 8 }),
  ops: fc.array(opArb, { maxLength: 40 })
})

describe('turn loop (6d.2e)', () => {
  it('never opens capture while the interviewer could still be audible (no self-transcription)', () => {
    runProperty('no-self-transcription', scheduleArb, ({ plans, ops }) => {
      const { loop, clock } = build(plans)
      let lastMarker: number | null = null
      let speaking = false
      let guardUntil = 0
      const audible = (t: number): boolean => speaking || (guardUntil > 0 && t < guardUntil)
      for (const op of ops) {
        if (op.op === 'tick') clock.t += op.dt
        else if (op.op === 'eot') {
          const turn = loop.endOfTurn()
          if (turn) {
            lastMarker = turn.marker
            speaking = true
          }
        } else if (lastMarker !== null && speaking) {
          loop.ttsEnded(lastMarker)
          speaking = false
          guardUntil = clock.t + GUARD_MS
        }
        if (loop.captureOpen(clock.t) && audible(clock.t)) return false
      }
      return true
    })
  })

  it('a realized turn is produced exactly once per accepted end-of-turn; barge-in is ignored', () => {
    runProperty('turn-per-eot', scheduleArb, ({ plans, ops }) => {
      const { loop } = build(plans)
      let accepted = 0
      let lastMarker: number | null = null
      let speaking = false
      for (const op of ops) {
        if (op.op === 'eot') {
          const turn = loop.endOfTurn()
          if (speaking && turn !== null) return false
          if (turn) {
            accepted++
            lastMarker = turn.marker
            speaking = true
          }
        } else if (op.op === 'end' && lastMarker !== null && speaking) {
          loop.ttsEnded(lastMarker)
          speaking = false
        }
      }
      return loop.turns().length === accepted
    })
  })

  it('every realized turn conforms to the intent seam', () => {
    runProperty('seam-honored', scheduleArb, ({ plans, ops }) => {
      const { loop } = build(plans)
      let lastMarker: number | null = null
      for (const op of ops) {
        if (op.op === 'eot') {
          const turn = loop.endOfTurn()
          if (turn) lastMarker = turn.marker
        } else if (op.op === 'end' && lastMarker !== null) loop.ttsEnded(lastMarker)
      }
      return loop.turns().every((t) => conformsToSeam(t.plan, t.realized))
    })
  })
})

describe('turn loop wiring (6d.2e)', () => {
  const onePlan: DirectedAction[] = [{ intent: { kind: 'ask_intro' }, authority: 'command' }]

  it('streams one phrased line per realized action then a marker', () => {
    const { loop, tts } = build([onePlan])
    const turn = loop.endOfTurn()!
    expect(turn.lines).toEqual([stubPhraser.phrase({ kind: 'ask_intro' })])
    expect(tts.spoken).toEqual(turn.lines)
    expect(tts.events.at(-1)).toEqual({ type: 'finish', marker: turn.marker })
  })

  it('capture stays shut through playback and the echo-tail guard, then reopens', () => {
    const clock = new Clock(1000)
    const { loop } = build([onePlan], clock)
    loop.endOfTurn()
    expect(loop.captureOpen(clock.t)).toBe(false)
    clock.t = 1500
    loop.ttsEnded(0)
    expect(loop.captureOpen(clock.t)).toBe(false)
    expect(loop.captureOpen(1500 + GUARD_MS - 1)).toBe(false)
    expect(loop.captureOpen(1500 + GUARD_MS)).toBe(true)
  })

  it('ignores a stale or mismatched marker', () => {
    const { loop } = build([onePlan])
    loop.endOfTurn()
    loop.ttsEnded(99)
    expect(loop.speaking).toBe(true)
  })

  it('reset returns the loop to a clean listening state', () => {
    const { loop } = build([onePlan, onePlan])
    loop.endOfTurn()
    loop.reset()
    expect(loop.speaking).toBe(false)
    expect(loop.turns()).toHaveLength(0)
    expect(loop.captureOpen(10_000)).toBe(true)
  })
})
