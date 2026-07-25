import { encode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'
import { decodeOutMsg, encodeInMsg } from './codec'
import type { OutMsg } from './protocol'

const roundTrip = (msg: OutMsg): OutMsg => decodeOutMsg(encode(msg, { forceFloat32: true }))

describe('codec', () => {
  it('round-trips every OutMsg variant', () => {
    const msgs: OutMsg[] = [
      { type: 'Ready' },
      { type: 'Word', text: 'hi', start_time: 0.5 },
      { type: 'EndWord', stop_time: 0.75 },
      { type: 'Step', step_idx: 3, prs: [0, 0, 0.875] },
      { type: 'Marker', id: 5 },
      { type: 'Error', message: 'boom' }
    ]
    for (const m of msgs) expect(roundTrip(m)).toEqual(m)
  })

  it('encodes InMsg as bytes decodable back to the same shape', () => {
    const bytes = encodeInMsg({ type: 'Marker', id: 9 })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(decodeOutMsg(bytes)).toEqual({ type: 'Marker', id: 9 })
  })

  it('rejects frames without a type', () => {
    expect(() => decodeOutMsg(encode({ nope: 1 }))).toThrow(/malformed/)
  })

  it('rejects unknown out types', () => {
    expect(() => decodeOutMsg(encode({ type: 'Bogus' }))).toThrow(/unknown out type/)
  })
})
