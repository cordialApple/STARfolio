import { describe, it } from 'vitest'
import { decode, encode } from '@msgpack/msgpack'
import { runProperty, fc } from '../../pbt/pbt'
import { FakeTransport } from '../transport'
import { KyutaiTtsAdapter } from './adapter'
import type { TtsInMsg, TtsOutMsg } from './protocol'

const audioOut = fc.record({
  type: fc.constant('Audio' as const),
  pcm: fc.array(fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), { maxLength: 8 })
})
const markerOut = fc.record({ type: fc.constant('Marker' as const), id: fc.nat() })
const errorOut = fc.record({ type: fc.constant('Error' as const), message: fc.string({ maxLength: 12 }) })

const ttsOut: fc.Arbitrary<TtsOutMsg> = fc.oneof(
  { weight: 3, arbitrary: audioOut },
  { weight: 1, arbitrary: markerOut },
  { weight: 1, arbitrary: errorOut }
)
const schedule = fc.array(ttsOut, { maxLength: 30 })

interface Driven {
  audio: number[][]
  ends: number[]
  errors: string[]
  order: string[]
  startCount: number
}

function drive(msgs: TtsOutMsg[]): Driven {
  const transport = new FakeTransport()
  const out: Driven = { audio: [], ends: [], errors: [], order: [], startCount: 0 }
  new KyutaiTtsAdapter({
    transport,
    onAudio: (pcm) => {
      out.audio.push(Array.from(pcm))
      out.order.push('audio')
    },
    onStart: () => {
      out.startCount++
      out.order.push('start')
    },
    onEnd: (id) => out.ends.push(id),
    onError: (m) => out.errors.push(m)
  })
  transport.deliver(encode({ type: 'Ready' }))
  for (const msg of msgs) transport.deliver(encode(msg))
  return out
}

const isAudio = (m: TtsOutMsg): m is Extract<TtsOutMsg, { type: 'Audio' }> => m.type === 'Audio'

describe('tts adapter (PBT)', () => {
  // [in-memory FakeTransport, MODELLED wire, NO moshi TTS server — proves the streaming
  //  adapter's ordering/gating, not synthesis quality; see docs/plans/pbt-in-ci.md §7]
  it('emits every Audio chunk in delivered order, samples conserved', () => {
    runProperty('tts/audio-order-preserved', schedule, (msgs) => {
      const { audio } = drive(msgs)
      const expected = msgs.filter(isAudio).map((m) => m.pcm.map((v) => Math.fround(v)))
      return JSON.stringify(audio) === JSON.stringify(expected)
    })
  })

  it('onStart fires exactly once, before the first audio, only when audio flows', () => {
    runProperty('tts/start-fires-once-before-audio', schedule, (msgs) => {
      const { order, startCount } = drive(msgs)
      const anyAudio = msgs.some(isAudio)
      if (startCount !== (anyAudio ? 1 : 0)) return false
      if (!anyAudio) return order.indexOf('start') === -1
      return order[0] === 'start' && order.indexOf('audio') === 1
    })
  })

  it('onEnd mirrors every Marker id in delivered order', () => {
    runProperty('tts/end-mirrors-markers', schedule, (msgs) => {
      const { ends } = drive(msgs)
      const expected = msgs.filter((m) => m.type === 'Marker').map((m) => (m as { id: number }).id)
      return JSON.stringify(ends) === JSON.stringify(expected)
    })
  })

  it('forwards every Error message in delivered order', () => {
    runProperty('tts/errors-forwarded', schedule, (msgs) => {
      const { errors } = drive(msgs)
      const expected = msgs.filter((m) => m.type === 'Error').map((m) => (m as { message: string }).message)
      return JSON.stringify(errors) === JSON.stringify(expected)
    })
  })

  it('buffers pre-Ready calls and flushes them in call order', () => {
    const call = fc.oneof(
      fc.record({ kind: fc.constant('speak' as const), text: fc.string({ maxLength: 6 }) }),
      fc.record({ kind: fc.constant('finish' as const) })
    )
    runProperty('tts/pending-flushed-in-call-order', fc.array(call, { maxLength: 12 }), (calls) => {
      const transport = new FakeTransport()
      const adapter = new KyutaiTtsAdapter({ transport, onAudio: () => {} })
      const expected: TtsInMsg[] = []
      for (const c of calls) {
        if (c.kind === 'speak') {
          adapter.speak(c.text)
          expected.push({ type: 'Text', text: c.text })
        } else {
          expected.push({ type: 'Marker', id: adapter.finish() })
        }
      }
      if (transport.sent.length !== 0) return false
      transport.deliver(encode({ type: 'Ready' }))
      if (transport.sent.length !== expected.length) return false
      return transport.sent.every((b, i) => JSON.stringify(decode(b)) === JSON.stringify(expected[i]))
    })
  })
})
