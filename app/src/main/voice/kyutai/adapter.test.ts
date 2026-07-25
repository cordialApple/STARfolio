import { decode, encode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../streaming/types'
import { KyutaiSttAdapter } from './adapter'
import { BLOCK_SAMPLES, eotPrs, type InMsg, type OutMsg } from './protocol'
import { StubTransport } from './stub'
import { FakeTransport } from './transport'

const frame = (msg: OutMsg) => encode(msg, { forceFloat32: true })
const ready = () => frame({ type: 'Ready' })
const word = (text: string, t = 0) => frame({ type: 'Word', text, start_time: t })
const eot = (): Uint8Array => frame({ type: 'Step', step_idx: 0, prs: eotPrs(0.2) })

function decodeSent(t: FakeTransport): InMsg[] {
  return t.sent.map((b) => decode(b) as InMsg)
}

describe('KyutaiSttAdapter', () => {
  it('buffers outbound frames until Ready, then flushes in order', () => {
    const t = new FakeTransport()
    const adapter = new KyutaiSttAdapter({ transport: t, onTranscript: () => {} })
    adapter.pushFrames(new Float32Array(BLOCK_SAMPLES)) // one 24k block's worth pre-Ready
    expect(t.sent).toEqual([])
    t.deliver(ready())
    expect(t.sent.length).toBeGreaterThan(0)
    expect(decodeSent(t).every((m) => m.type === 'Audio')).toBe(true)
    adapter.close()
  })

  it('flushes the padded tail and a Marker on finish', () => {
    const t = new FakeTransport()
    const adapter = new KyutaiSttAdapter({ transport: t, onTranscript: () => {} })
    t.deliver(ready())
    adapter.pushFrames(new Float32Array(10)) // less than a block — stays buffered
    const id = adapter.finish()
    const sent = decodeSent(t)
    expect(sent.at(-1)).toEqual({ type: 'Marker', id })
    expect(sent.some((m) => m.type === 'Audio')).toBe(true)
  })

  it('maps committed words to non-final events and EOT to a final one', () => {
    const t = new FakeTransport()
    const events: TranscriptEvent[] = []
    const adapter = new KyutaiSttAdapter({ transport: t, onTranscript: (e) => events.push(e) })
    t.deliver(ready())
    t.deliver(word('tell'))
    t.deliver(word('me', 0.4))
    t.deliver(eot())
    expect(events.map((e) => [e.text, e.isFinal])).toEqual([
      ['tell', false],
      ['tell me', false],
      ['tell me', true]
    ])
    for (const e of events) expect(e.stableUpTo).toBe(e.text.length)
    adapter.close()
  })

  it('surfaces transport errors', () => {
    const t = new FakeTransport()
    let err = ''
    new KyutaiSttAdapter({ transport: t, onTranscript: () => {}, onError: (m) => (err = m) })
    t.fireError(new Error('socket down'))
    expect(err).toBe('socket down')
  })

  it('drives a full turn against the stub transport', async () => {
    const t = new StubTransport()
    const events: TranscriptEvent[] = []
    let drainedId = -1
    const adapter = new KyutaiSttAdapter({
      transport: t,
      onTranscript: (e) => events.push(e),
      onDrained: (id) => (drainedId = id)
    })
    for (let i = 0; i < 6; i++) adapter.pushFrames(new Float32Array(BLOCK_SAMPLES))
    const id = adapter.finish()
    for (let i = 0; i < 40; i++) await Promise.resolve()
    const final = events.filter((e) => e.isFinal).at(-1)
    expect(final?.text).toBe('tell me about a time')
    expect(final?.stableUpTo).toBe('tell me about a time'.length)
    expect(drainedId).toBe(id)
    adapter.close()
  })
})
