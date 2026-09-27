import { describe, expect, it } from 'vitest'
import type { MoshiTimingEvent } from '../../../preload/index.d'
import { createLatencySession } from './latency-session'

function setup() {
  const events: MoshiTimingEvent[] = []
  const session = createLatencySession({
    emit: (event) => events.push(event),
    now: () => 1000,
    timeOriginUtcMs: 1_800_000_000_000,
    sampleRate: 1000
  })
  return { events, session }
}

describe('latency session', () => {
  it('emits ordered renderer clock events with separate UTC origin', () => {
    const { events, session } = setup()
    session.micReady()
    session.input(new Float32Array(10).fill(0.4), {
      startSample: 0,
      endSample: 10,
      observedAtMs: 900,
      estimatedEndAtMs: 900,
      uncertaintyMs: null
    })
    expect(events.map((event) => event.sequence)).toEqual([1, 2])
    expect(events[0]).toEqual(
      expect.objectContaining({
        kind: 'mic-ready',
        rendererTimeMs: 1000,
        rendererTimeOriginUtcMs: 1_800_000_000_000
      })
    )
    expect(events[1]).toEqual(
      expect.objectContaining({
        kind: 'candidate-speech-start',
        sampleOffset: 0,
        estimatedAtMs: 890,
        observedAtMs: 900,
        uncertaintyMs: null
      })
    )
  })

  it('schedules first voiced sample after leading silence and injected queue delay', () => {
    const { events, session } = setup()
    session.output(Float32Array.from([...Array(10).fill(0), ...Array(10).fill(0.4)]), {
      receivedAtMs: 100,
      scheduledStartMs: 500,
      clockSource: 'renderer-fallback'
    })
    expect(events.map((event) => event.kind)).toEqual([
      'audio-received',
      'assistant-voice-scheduled'
    ])
    expect(events[1]).toEqual(
      expect.objectContaining({
        sampleOffset: 10,
        estimatedAtMs: 510,
        observedAtMs: 100,
        queuedMs: 400,
        clockSource: 'renderer-fallback'
      })
    )
  })

  it('maps cross-chunk voiced onset to chunk where sample started', () => {
    const { events, session } = setup()
    session.output(new Float32Array(5).fill(0.4), {
      receivedAtMs: 100,
      scheduledStartMs: 500
    })
    session.output(new Float32Array(5).fill(0.4), {
      receivedAtMs: 110,
      scheduledStartMs: 505
    })
    expect(events.find((event) => event.kind === 'assistant-voice-scheduled')).toEqual(
      expect.objectContaining({ sampleOffset: 0, estimatedAtMs: 500, observedAtMs: 100 })
    )
  })

  it('records no reply without inventing an assistant segment', () => {
    const { events, session } = setup()
    session.input(new Float32Array(10).fill(0.4), {
      startSample: 0,
      endSample: 10,
      observedAtMs: 900,
      estimatedEndAtMs: 900,
      uncertaintyMs: null
    })
    session.finish()
    expect(events.map((event) => event.kind)).toEqual([
      'candidate-speech-start',
      'candidate-speech-end',
      'session-ended'
    ])
    expect(events.at(-1)).toEqual(expect.objectContaining({ status: 'unanswered' }))
  })

  it('marks overlapping assistant onset ambiguous without pairing turns', () => {
    const { events, session } = setup()
    session.input(new Float32Array(10).fill(0.4), {
      startSample: 0,
      endSample: 10,
      observedAtMs: 900,
      estimatedEndAtMs: 900,
      uncertaintyMs: null
    })
    session.output(new Float32Array(10).fill(0.4), {
      receivedAtMs: 910,
      scheduledStartMs: 920
    })
    expect(events.find((event) => event.kind === 'assistant-voice-scheduled')).toEqual(
      expect.objectContaining({ status: 'ambiguous' })
    )
  })

  it('marks open assistant voice interrupted at session finish', () => {
    const { events, session } = setup()
    session.output(new Float32Array(10).fill(0.4), {
      receivedAtMs: 100,
      scheduledStartMs: 500
    })
    session.finish()
    expect(events.map((event) => event.kind)).toEqual([
      'audio-received',
      'assistant-voice-scheduled',
      'assistant-voice-interrupted',
      'session-ended'
    ])
    expect(events[2]).toEqual(expect.objectContaining({ status: 'cancelled', sampleOffset: 10 }))
  })

  it('records natural assistant voice end after sustained silence', () => {
    const { events, session } = setup()
    session.output(new Float32Array(10).fill(0.4), {
      receivedAtMs: 100,
      scheduledStartMs: 500
    })
    session.output(new Float32Array(120), {
      receivedAtMs: 120,
      scheduledStartMs: 510
    })
    expect(events.find((event) => event.kind === 'assistant-voice-end')).toEqual(
      expect.objectContaining({ sampleOffset: 10, estimatedAtMs: 510 })
    )
  })
})
