import { encode } from '@msgpack/msgpack'
import type { OutMsg, StepOut } from '../kyutai/protocol'
import { PAUSE_HEAD_INDEX, eotPrs } from '../kyutai/protocol'
import { fc } from './pbt'

export const wordText = fc.string({ minLength: 1, maxLength: 6 })

const time = fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true })

const prsArb = fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
  minLength: PAUSE_HEAD_INDEX + 1,
  maxLength: PAUSE_HEAD_INDEX + 2
})

export const stepOut: fc.Arbitrary<StepOut> = fc.record({
  type: fc.constant('Step' as const),
  step_idx: fc.nat(),
  prs: prsArb
})

export const eotStepOut: fc.Arbitrary<StepOut> = fc.record({
  type: fc.constant('Step' as const),
  step_idx: fc.nat(),
  prs: fc.constant(eotPrs())
})

export const outMsg: fc.Arbitrary<OutMsg> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ type: fc.constant('Word' as const), text: wordText, start_time: time }) },
  { weight: 2, arbitrary: stepOut },
  { weight: 2, arbitrary: eotStepOut },
  { weight: 1, arbitrary: fc.constant({ type: 'Ready' as const }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('EndWord' as const), stop_time: time }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('Marker' as const), id: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('Error' as const), message: fc.string() }) }
)

export const outSchedule: fc.Arbitrary<OutMsg[]> = fc.array(outMsg, { maxLength: 40 })

export function toWire(msg: OutMsg): Uint8Array {
  return encode(msg)
}

export const pcmFrame = fc
  .array(fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), { maxLength: 64 })
  .map((xs) => Float32Array.from(xs))

export const pcmChunks = fc.array(pcmFrame, { maxLength: 8 })
