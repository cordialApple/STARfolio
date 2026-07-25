import { encode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../streaming/types'
import { BLOCK_SAMPLES, eotPrs, type OutMsg } from './protocol'
import { KyutaiVoiceSession, type KyutaiSessionEvent } from './session'
import { FakeTransport } from './transport'

const frame = (msg: OutMsg) => encode(msg, { forceFloat32: true })
const ready = () => frame({ type: 'Ready' })
const word = (text: string, t = 0) => frame({ type: 'Word', text, start_time: t })
const eot = () => frame({ type: 'Step', step_idx: 0, prs: eotPrs(0.2) })

function harness(startAt = 1000) {
  let clock = startAt
  const t = new FakeTransport()
  const transcripts: TranscriptEvent[] = []
  const utterances: KyutaiSessionEvent[] = []
  const session = new KyutaiVoiceSession((e) => utterances.push(e), {
    onTranscript: (e) => transcripts.push(e),
    transport: t,
    now: () => clock
  })
  t.deliver(ready())
  return { t, transcripts, utterances, session, tick: (ms: number) => (clock += ms) }
}

describe('KyutaiVoiceSession', () => {
  it('drops mic frames while TTS speaks and through the guard tail', () => {
    const { t, session, tick } = harness()
    session.onTtsStart()
    session.pushFrames(new Float32Array(BLOCK_SAMPLES))
    expect(t.sent).toEqual([])

    session.onTtsEnd()
    tick(100) // still inside the 250ms guard
    session.pushFrames(new Float32Array(BLOCK_SAMPLES))
    expect(t.sent).toEqual([])

    tick(300) // past the guard tail
    session.pushFrames(new Float32Array(BLOCK_SAMPLES))
    expect(t.sent.length).toBeGreaterThan(0)
  })

  it('maps the first word to utteranceStart and EOT to utteranceEnd', () => {
    const { t, transcripts, utterances } = harness()
    t.deliver(word('tell'))
    t.deliver(word('me', 0.4))
    t.deliver(eot())

    expect(utterances.map((e) => e.kind)).toEqual(['utteranceStart', 'utteranceEnd'])
    expect(utterances.every((e) => e.dropped === 0)).toBe(true)

    const final = transcripts.at(-1)
    expect(final).toMatchObject({ text: 'tell me', isFinal: true })
    expect(final?.stableUpTo).toBe('tell me'.length)
  })

  it('stops forwarding frames after close', () => {
    const { t, session } = harness()
    session.close()
    expect(t.closed).toBe(true)
    session.pushFrames(new Float32Array(BLOCK_SAMPLES))
    expect(t.sent).toEqual([])
  })
})
