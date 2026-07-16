import { describe, expect, it } from 'vitest'
import {
  VoiceStreamSession,
  defaultFrameSourceConfig,
  defaultRingBufferConfig
} from '../../src/main/voice/streaming'
import type { StreamSessionEvent } from '../../src/main/voice/streaming'

function speech(n: number): Float32Array {
  return new Float32Array(n).fill(0.1)
}
function silence(n: number): Float32Array {
  return new Float32Array(n).fill(0)
}

describe('VoiceStreamSession', () => {
  it('emits utteranceStart then utteranceEnd across a full turn', () => {
    const events: StreamSessionEvent[] = []
    const session = new VoiceStreamSession((e) => events.push(e))
    session.pushFrames(silence(512 * 2))
    session.pushFrames(speech(512 * 6))
    expect(events.map((e) => e.kind)).toEqual(['utteranceStart'])
    expect(session.inUtterance).toBe(true)
    session.pushFrames(silence(512 * 45))
    expect(events.map((e) => e.kind)).toEqual(['utteranceStart', 'utteranceEnd'])
    expect(session.inUtterance).toBe(false)
  })

  it('tags each event with the running dropped-sample count', () => {
    const events: StreamSessionEvent[] = []
    const session = new VoiceStreamSession((e) => events.push(e), {
      vad: defaultFrameSourceConfig().vad,
      ring: defaultRingBufferConfig({ capacitySamples: 1024 })
    })
    session.pushFrames(speech(4096))
    session.pushFrames(speech(512 * 6))
    expect(session.droppedSamples).toBeGreaterThan(0)
    expect(events.every((e) => e.dropped >= 0)).toBe(true)
  })

  it('drops frames after close and stops emitting', () => {
    const events: StreamSessionEvent[] = []
    const session = new VoiceStreamSession((e) => events.push(e))
    session.close()
    session.pushFrames(speech(512 * 8))
    expect(events).toEqual([])
    expect(session.inUtterance).toBe(false)
  })

  it('reset returns to idle so a fresh turn starts clean', () => {
    const events: StreamSessionEvent[] = []
    const session = new VoiceStreamSession((e) => events.push(e))
    session.pushFrames(speech(512 * 6))
    session.reset()
    expect(session.inUtterance).toBe(false)
    events.length = 0
    session.pushFrames(speech(512 * 6))
    expect(events.map((e) => e.kind)).toEqual(['utteranceStart'])
  })
})
