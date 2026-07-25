import { decode, encode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'
import { KyutaiTtsAdapter } from './adapter'
import type { TtsInMsg, TtsOutMsg } from './protocol'
import { StubTtsTransport } from './stub'
import { FakeTransport } from '../transport'

const frame = (msg: TtsOutMsg): Uint8Array => encode(msg)
const ready = (): Uint8Array => frame({ type: 'Ready' })

function decodeSent(t: FakeTransport): TtsInMsg[] {
  return t.sent.map((b) => decode(b) as TtsInMsg)
}

describe('KyutaiTtsAdapter', () => {
  it('buffers outbound text until Ready, then flushes in order', () => {
    const t = new FakeTransport()
    const adapter = new KyutaiTtsAdapter({ transport: t, onAudio: () => {} })
    adapter.speak('hello')
    adapter.speak('world')
    expect(t.sent).toEqual([])
    t.deliver(ready())
    expect(decodeSent(t)).toEqual([
      { type: 'Text', text: 'hello' },
      { type: 'Text', text: 'world' }
    ])
    adapter.close()
  })

  it('emits audio chunks and fires onStart once on the first chunk', () => {
    const t = new FakeTransport()
    const chunks: number[][] = []
    let starts = 0
    const adapter = new KyutaiTtsAdapter({
      transport: t,
      onAudio: (pcm) => chunks.push(Array.from(pcm)),
      onStart: () => starts++
    })
    t.deliver(ready())
    t.deliver(frame({ type: 'Audio', pcm: [0, 0.5] }))
    t.deliver(frame({ type: 'Audio', pcm: [0.25] }))
    expect(starts).toBe(1)
    expect(chunks).toEqual([[0, Math.fround(0.5)], [Math.fround(0.25)]])
    adapter.close()
  })

  it('signals end on the Marker echo for the id from finish', () => {
    const t = new FakeTransport()
    let ended = -1
    const adapter = new KyutaiTtsAdapter({ transport: t, onAudio: () => {}, onEnd: (id) => (ended = id) })
    t.deliver(ready())
    const id = adapter.finish()
    expect(decodeSent(t).at(-1)).toEqual({ type: 'Marker', id })
    t.deliver(frame({ type: 'Marker', id }))
    expect(ended).toBe(id)
    adapter.close()
  })

  it('surfaces transport errors', () => {
    const t = new FakeTransport()
    let err = ''
    new KyutaiTtsAdapter({ transport: t, onAudio: () => {}, onError: (m) => (err = m) })
    t.fireError(new Error('tts socket down'))
    expect(err).toBe('tts socket down')
  })

  it('drives a full utterance against the stub transport', async () => {
    const t = new StubTtsTransport()
    const chunks: Float32Array[] = []
    let ended = -1
    const adapter = new KyutaiTtsAdapter({
      transport: t,
      onAudio: (pcm) => chunks.push(pcm),
      onEnd: (id) => (ended = id)
    })
    for (let i = 0; i < 20; i++) await Promise.resolve()
    adapter.speak('tell me')
    const id = adapter.finish()
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(chunks.length).toBeGreaterThan(0)
    expect(ended).toBe(id)
    adapter.close()
  })
})
