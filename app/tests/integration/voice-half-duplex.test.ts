import { describe, expect, it } from 'vitest'
import { VoiceStreamSession, defaultFrameSourceConfig } from '../../src/main/voice/streaming'
import type { StreamSessionEvent } from '../../src/main/voice/streaming'

function speech(n: number): Float32Array {
  return new Float32Array(n).fill(0.1)
}
function silence(n: number): Float32Array {
  return new Float32Array(n).fill(0)
}

describe('VoiceStreamSession half-duplex mic gating', () => {
  it('mutes the mic while TTS is speaking', () => {
    const events: StreamSessionEvent[] = []
    const now = 0
    const session = new VoiceStreamSession((e) => events.push(e), defaultFrameSourceConfig(), {
      now: () => now,
      halfDuplex: { guardMs: 250 }
    })
    session.onTtsStart()
    session.pushFrames(speech(512 * 6))
    expect(events).toEqual([])
    expect(session.inUtterance).toBe(false)
  })

  it('drops frames in the guard tail then reopens clean once the guard passes', () => {
    const events: StreamSessionEvent[] = []
    let now = 0
    const session = new VoiceStreamSession((e) => events.push(e), defaultFrameSourceConfig(), {
      now: () => now,
      halfDuplex: { guardMs: 250 }
    })
    session.onTtsStart()
    now = 1000
    session.onTtsEnd()
    session.pushFrames(silence(512 * 2))
    session.pushFrames(speech(512 * 6))
    expect(events).toEqual([])
    expect(session.inUtterance).toBe(false)

    now = 1250
    session.pushFrames(silence(512 * 2))
    session.pushFrames(speech(512 * 6))
    expect(events.map((e) => e.kind)).toEqual(['utteranceStart'])
    expect(session.inUtterance).toBe(true)
  })

  it('behaves like a plain session when TTS never fires', () => {
    const events: StreamSessionEvent[] = []
    const now = 0
    const session = new VoiceStreamSession((e) => events.push(e), defaultFrameSourceConfig(), {
      now: () => now,
      halfDuplex: { guardMs: 250 }
    })
    session.pushFrames(silence(512 * 2))
    session.pushFrames(speech(512 * 6))
    expect(events.map((e) => e.kind)).toEqual(['utteranceStart'])
    expect(session.inUtterance).toBe(true)
  })

  it('drops an in-progress utterance when TTS starts mid-utterance', () => {
    const events: StreamSessionEvent[] = []
    let now = 0
    const session = new VoiceStreamSession((e) => events.push(e), defaultFrameSourceConfig(), {
      now: () => now,
      halfDuplex: { guardMs: 250 }
    })
    session.pushFrames(silence(512 * 2))
    session.pushFrames(speech(512 * 6))
    expect(events.map((e) => e.kind)).toEqual(['utteranceStart'])
    expect(session.inUtterance).toBe(true)

    session.onTtsStart()
    expect(session.inUtterance).toBe(false)
    now = 1000
    session.onTtsEnd()
    now = 1250
    events.length = 0
    session.pushFrames(silence(512 * 2))
    session.pushFrames(speech(512 * 6))
    expect(events.map((e) => e.kind)).toEqual(['utteranceStart'])
    expect(session.inUtterance).toBe(true)
  })
})
