import { describe, it } from 'vitest'
import { encode, decode } from '@msgpack/msgpack'
import { defineSyntheticOrganicProperty, runProperty, fc } from '../pbt/pbt'
import { outMsg } from '../pbt/events'
import { OUT_TYPES, decodeOutMsg, encodeInMsg } from './codec'
import type { InMsg } from './protocol'

const inMsg: fc.Arbitrary<InMsg> = fc.oneof(
  fc.constant({ type: 'Init' as const }),
  fc.record({ type: fc.constant('Marker' as const), id: fc.nat() }),
  fc.record({
    type: fc.constant('Audio' as const),
    pcm: fc.array(fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), {
      maxLength: 32
    })
  })
)

const notAnOutFrame = fc.oneof(
  fc.record({}),
  fc.record({ nottype: fc.string() }),
  fc.record({ type: fc.integer() }),
  fc.record({ type: fc.string().filter((s) => !OUT_TYPES.has(s)) })
)

describe('codec (PBT)', () => {
  it('OutMsg round-trips through the wire unchanged', () => {
    runProperty(
      defineSyntheticOrganicProperty(
        'codec/outmsg-roundtrip',
        '1',
        'outbound STT messages round trip unchanged'
      ),
      outMsg,
      (msg) => {
        const back = decodeOutMsg(encode(msg))
        return JSON.stringify(back) === JSON.stringify(msg)
      }
    )
  })

  it('InMsg round-trips, pcm within float32 precision', () => {
    runProperty(
      defineSyntheticOrganicProperty(
        'codec/inmsg-roundtrip',
        '1',
        'inbound STT messages round trip within float32 precision'
      ),
      inMsg,
      (msg) => {
        const back = decode(encodeInMsg(msg)) as InMsg
        if (msg.type !== 'Audio') return JSON.stringify(back) === JSON.stringify(msg)
        if (back.type !== 'Audio' || back.pcm.length !== msg.pcm.length) return false
        return msg.pcm.every((v, i) => Object.is(Math.fround(v), back.pcm[i]))
      }
    )
  })

  it('rejects any frame that is not a known out type', () => {
    runProperty(
      defineSyntheticOrganicProperty(
        'codec/reject-unknown',
        '1',
        'STT codec rejects unknown outbound frames'
      ),
      notAnOutFrame,
      (bad) => {
        try {
          decodeOutMsg(encode(bad))
          return false
        } catch {
          return true
        }
      }
    )
  })
})
