import { describe, expect, it } from 'vitest'
import {
  FrameSource,
  defaultFrameSourceConfig,
  defaultVadConfig,
  defaultRingBufferConfig,
  type VadEvent
} from '../../src/main/voice/streaming'

const FRAME = 512
const MIN_SPEECH_FRAMES = 4
const HANGOVER_FRAMES = 40

function block(value: number, frames: number): Float32Array {
  return new Float32Array(frames * FRAME).fill(value)
}

function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function feedChunked(fs: FrameSource, signal: Float32Array, chunk: number): VadEvent[] {
  const events: VadEvent[] = []
  for (let i = 0; i < signal.length; i += chunk) {
    events.push(...fs.ingest(signal.subarray(i, i + chunk)).events)
  }
  return events
}

function feedChunkedSizes(fs: FrameSource, signal: Float32Array, sizes: number[]): VadEvent[] {
  const events: VadEvent[] = []
  let i = 0
  let s = 0
  while (i < signal.length) {
    const size = sizes[s % sizes.length]
    events.push(...fs.ingest(signal.subarray(i, i + size)).events)
    i += size
    s++
  }
  return events
}

describe('frame-source pipeline: renderer-style small buffers over a realistic turn', () => {
  it('segments silence→speech→short-pause→speech→long-silence into exactly one start and one end', () => {
    const fs = new FrameSource(defaultFrameSourceConfig())
    const signal = concat(
      block(0, 8),
      block(0.1, 12),
      block(0, HANGOVER_FRAMES - 10),
      block(0.1, 6),
      block(0, HANGOVER_FRAMES + 5)
    )

    const events = feedChunked(fs, signal, 128)

    expect(events).toEqual(['utteranceStart', 'utteranceEnd'])
    expect(fs.inUtterance).toBe(false)
  })

  it('a mid-turn pause shorter than the hangover never ends the turn', () => {
    const fs = new FrameSource(defaultFrameSourceConfig())
    const events = feedChunked(
      fs,
      concat(block(0.1, MIN_SPEECH_FRAMES + 2), block(0, HANGOVER_FRAMES - 1)),
      128
    )

    expect(events).toEqual(['utteranceStart'])
    expect(fs.inUtterance).toBe(true)
  })
})

describe('frame-source pipeline: frame reconstruction is independent of buffer chunking', () => {
  it('odd buffer sizes that do not divide frameSamples yield the same events as one contiguous buffer', () => {
    const signal = concat(block(0, 5), block(0.1, MIN_SPEECH_FRAMES + 3))

    const chunked = feedChunkedSizes(new FrameSource(defaultFrameSourceConfig()), signal, [100, 300, 333])
    const oneShot = new FrameSource(defaultFrameSourceConfig())
    const contiguous = oneShot.ingest(signal).events

    expect(chunked).toEqual(['utteranceStart'])
    expect(chunked).toEqual(contiguous)
    expect(oneShot.inUtterance).toBe(true)
  })
})

describe('frame-source pipeline: ring backpressure under flood', () => {
  it('drops oldest samples without throwing and still starts on a surviving speech run', () => {
    const fs = new FrameSource(
      defaultFrameSourceConfig({ ring: defaultRingBufferConfig({ capacitySamples: 1024 }) })
    )

    // Single ingest far larger than the ring: drop-oldest keeps only the last 1024 samples,
    // so most of this speech never reaches the VAD.
    const flood = new Float32Array(100000).fill(0.1)
    expect(() => fs.ingest(flood)).not.toThrow()
    expect(fs.droppedSamples).toBeGreaterThan(0)

    // Drop-oldest can perforate a continuous speech run, but the frames that DO survive are still
    // pure speech, so a steady follow-on stream reaccumulates minSpeechFrames and starts the turn.
    const events: VadEvent[] = []
    for (let i = 0; i < MIN_SPEECH_FRAMES + 2; i++) events.push(...fs.ingest(block(0.1, 1)).events)

    expect(events).toContain('utteranceStart')
    expect(fs.inUtterance).toBe(true)
  })
})

describe('frame-source pipeline: continuity across two turns', () => {
  it('emits start/end twice for two speech runs separated by long silences', () => {
    const fs = new FrameSource(defaultFrameSourceConfig())
    const signal = concat(
      block(0.1, 10),
      block(0, HANGOVER_FRAMES + 5),
      block(0.1, 10),
      block(0, HANGOVER_FRAMES + 5)
    )

    const events = feedChunked(fs, signal, 128)

    expect(events).toEqual(['utteranceStart', 'utteranceEnd', 'utteranceStart', 'utteranceEnd'])
    expect(fs.inUtterance).toBe(false)
  })
})

describe('frame-source pipeline: reset mid-stream', () => {
  it('returns to idle and starts a fresh utterance afterward', () => {
    const fs = new FrameSource(defaultFrameSourceConfig())

    feedChunked(fs, block(0.1, MIN_SPEECH_FRAMES + 2), 128)
    fs.ingest(new Float32Array(300).fill(0.1))
    expect(fs.inUtterance).toBe(true)
    expect(fs.backlog).toBeGreaterThan(0)

    fs.reset()
    expect(fs.inUtterance).toBe(false)
    expect(fs.backlog).toBe(0)
    expect(fs.droppedSamples).toBe(0)

    const events = feedChunked(fs, block(0.1, MIN_SPEECH_FRAMES + 2), 128)
    expect(events).toEqual(['utteranceStart'])
    expect(fs.inUtterance).toBe(true)
  })
})

describe('frame-source pipeline: config sanity', () => {
  it('confirms the VAD tuning the segmentation assertions depend on', () => {
    const vad = defaultVadConfig()
    expect(vad.frameSamples).toBe(FRAME)
    expect(vad.minSpeechFrames).toBe(MIN_SPEECH_FRAMES)
    expect(vad.hangoverFrames).toBe(HANGOVER_FRAMES)
  })
})
