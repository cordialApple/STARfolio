import { describe, it } from 'vitest'
import { decode, encode } from '@msgpack/msgpack'
import { runProperty, fc } from '../../pbt/pbt'
import { TTS_OUT_TYPES, decodeTtsOut, encodeTtsIn } from './codec'
import type { TtsInMsg, TtsOutMsg } from './protocol'

const outMsg: fc.Arbitrary<TtsOutMsg> = fc.oneof(
  fc.constant({ type: 'Ready' as const }),
  fc.record({
    type: fc.constant('Audio' as const),
    pcm: fc.array(fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), { maxLength: 16 })
  }),
  fc.record({ type: fc.constant('Marker' as const), id: fc.nat() }),
  fc.record({ type: fc.constant('Error' as const), message: fc.string({ maxLength: 16 }) })
)

const inMsg: fc.Arbitrary<TtsInMsg> = fc.oneof(
  fc.record({ type: fc.constant('Text' as const), text: fc.string({ maxLength: 16 }) }),
  fc.record({ type: fc.constant('Marker' as const), id: fc.nat() })
)

const notATtsOutFrame = fc.oneof(
  fc.record({}),
  fc.record({ nottype: fc.string() }),
  fc.record({ type: fc.integer() }),
  fc.record({ type: fc.string().filter((s) => !TTS_OUT_TYPES.has(s)) })
)

describe('tts codec (PBT)', () => {
  it('OutMsg round-trips through the wire unchanged', () => {
    runProperty('tts/codec-outmsg-roundtrip', outMsg, (msg) => {
      const back = decodeTtsOut(encode(msg))
      return JSON.stringify(back) === JSON.stringify(msg)
    })
  })

  it('InMsg round-trips unchanged', () => {
    runProperty('tts/codec-inmsg-roundtrip', inMsg, (msg) => {
      const back = decode(encodeTtsIn(msg)) as TtsInMsg
      return JSON.stringify(back) === JSON.stringify(msg)
    })
  })

  it('rejects any frame that is not a known out type', () => {
    runProperty('tts/codec-reject-unknown', notATtsOutFrame, (bad) => {
      try {
        decodeTtsOut(encode(bad))
        return false
      } catch {
        return true
      }
    })
  })
})
