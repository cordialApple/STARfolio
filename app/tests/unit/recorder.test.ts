import { describe, expect, it } from 'vitest'
import { createFrameSink } from '../../src/renderer/src/audio/recorder'

function frame(n: number, value: number): Float32Array {
  return new Float32Array(n).fill(value)
}

describe('createFrameSink — push-to-talk (no onFrames)', () => {
  it('accumulates every frame and returns Int16 PCM on finish', () => {
    const sink = createFrameSink()
    sink.push(frame(3, 1))
    sink.push(frame(2, -1))
    const pcm = sink.finish()
    expect(pcm).toBeInstanceOf(Int16Array)
    expect(pcm.length).toBe(5)
    expect([...pcm.slice(0, 3)]).toEqual([0x7fff, 0x7fff, 0x7fff])
    expect([...pcm.slice(3)]).toEqual([-0x8000, -0x8000])
  })

  it('clamps out-of-range samples before packing', () => {
    const sink = createFrameSink()
    sink.push(Float32Array.from([2, -2, 0]))
    expect([...sink.finish()]).toEqual([0x7fff, -0x8000, 0])
  })

  it('reports metered level every fourth frame', () => {
    const levels: number[] = []
    const sink = createFrameSink({ onLevel: (l) => levels.push(l) })
    for (let i = 0; i < 8; i++) sink.push(frame(4, 1))
    expect(levels.length).toBe(2)
    expect(levels[0]).toBeCloseTo(1)
  })
})

describe('createFrameSink — streaming (onFrames)', () => {
  it('never buffers the session and finishes with an empty Int16Array', () => {
    const batches: Float32Array[] = []
    const sink = createFrameSink({ onFrames: (f) => batches.push(f), batchSamples: 4 })
    sink.push(frame(3, 1))
    sink.push(frame(3, 1))
    const pcm = sink.finish()
    expect(pcm).toBeInstanceOf(Int16Array)
    expect(pcm.length).toBe(0)
  })

  it('emits a batch once batchSamples accumulate', () => {
    const batches: Float32Array[] = []
    const sink = createFrameSink({ onFrames: (f) => batches.push(f), batchSamples: 4 })
    sink.push(frame(2, 1))
    expect(batches.length).toBe(0)
    sink.push(frame(2, 1))
    expect(batches.length).toBe(1)
    expect(batches[0].length).toBe(4)
  })

  it('flushes a trailing partial batch on finish', () => {
    const batches: Float32Array[] = []
    const sink = createFrameSink({ onFrames: (f) => batches.push(f), batchSamples: 100 })
    sink.push(frame(5, 1))
    sink.finish()
    expect(batches.length).toBe(1)
    expect(batches[0].length).toBe(5)
  })

  it('does not flush when nothing is pending', () => {
    const batches: Float32Array[] = []
    const sink = createFrameSink({ onFrames: (f) => batches.push(f), batchSamples: 4 })
    sink.push(frame(4, 1))
    expect(batches.length).toBe(1)
    sink.finish()
    expect(batches.length).toBe(1)
  })
})
