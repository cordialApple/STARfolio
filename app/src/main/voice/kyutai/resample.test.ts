import { describe, expect, it } from 'vitest'
import { BlockChunker, LinearResampler } from './resample'

describe('LinearResampler', () => {
  it('produces ~outputRate/inputRate as many samples over a long stream', () => {
    const r = new LinearResampler(16000, 24000)
    const input = new Float32Array(16000).map((_, i) => Math.sin(i / 50))
    const out = r.process(input)
    expect(Math.abs(out.length - 24000)).toBeLessThanOrEqual(2)
  })

  it('keeps a constant signal constant (within input range)', () => {
    const r = new LinearResampler(16000, 24000)
    const out = r.process(new Float32Array(100).fill(0.7))
    for (const v of out) expect(v).toBeCloseTo(0.7, 5)
  })

  it('never exceeds the input min/max', () => {
    const r = new LinearResampler(16000, 24000)
    const input = Float32Array.from({ length: 200 }, (_, i) => (i % 2 ? 0.9 : -0.9))
    const out = r.process(input)
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(-0.9)
      expect(v).toBeLessThanOrEqual(0.9)
    }
  })

  it('preserves phase continuity across chunk boundaries', () => {
    const whole = new LinearResampler(16000, 24000)
    const split = new LinearResampler(16000, 24000)
    const input = Float32Array.from({ length: 300 }, (_, i) => Math.sin(i / 7))
    const a = whole.process(input)
    const b1 = split.process(input.slice(0, 150))
    const b2 = split.process(input.slice(150))
    const joined = Float32Array.from([...b1, ...b2])
    expect(joined.length).toBe(a.length)
    for (let i = 0; i < a.length; i++) expect(joined[i]).toBeCloseTo(a[i], 5)
  })

  it('returns empty for empty input', () => {
    expect(new LinearResampler(16000, 24000).process(new Float32Array(0)).length).toBe(0)
  })
})

describe('BlockChunker', () => {
  it('emits only full blocks and buffers the remainder', () => {
    const c = new BlockChunker(1920)
    expect(c.push(new Float32Array(1000))).toEqual([])
    const blocks = c.push(new Float32Array(1000))
    expect(blocks.length).toBe(1)
    expect(blocks[0].length).toBe(1920)
  })

  it('flush zero-pads the tail to a full block', () => {
    const c = new BlockChunker(1920)
    c.push(new Float32Array(500).fill(0.5))
    const tail = c.flush()!
    expect(tail.length).toBe(1920)
    expect(tail[0]).toBe(0.5)
    expect(tail[499]).toBe(0.5)
    expect(tail[500]).toBe(0)
    expect(c.flush()).toBeNull()
  })
})
