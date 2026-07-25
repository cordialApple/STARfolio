import { describe, it } from 'vitest'
import { SAMPLE_RATE } from '../streaming/types'
import { runProperty } from '../pbt/pbt'
import { pcmChunks } from '../pbt/events'
import { BLOCK_SAMPLES, STT_SAMPLE_RATE } from './protocol'
import { BlockChunker, LinearResampler } from './resample'

function concat(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Float32Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('LinearResampler (PBT)', () => {
  it('chunk-split invariance: split boundaries never change the resampled stream', () => {
    runProperty('resample/chunk-split-invariance', pcmChunks, (chunks) => {
      const split = new LinearResampler(SAMPLE_RATE, STT_SAMPLE_RATE)
      const splitOut = concat(chunks.map((c) => split.process(c)))
      const whole = new LinearResampler(SAMPLE_RATE, STT_SAMPLE_RATE)
      const wholeOut = whole.process(concat(chunks))
      if (splitOut.length !== wholeOut.length) return false
      return splitOut.every((v, i) => Object.is(v, wholeOut[i]))
    })
  })

  it('convex bound: every output sample lies within the input min/max', () => {
    runProperty('resample/convex-bound', pcmChunks, (chunks) => {
      const input = concat(chunks)
      if (input.length === 0) return true
      let lo = Infinity
      let hi = -Infinity
      for (const v of input) {
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      const out = new LinearResampler(SAMPLE_RATE, STT_SAMPLE_RATE).process(input)
      const eps = 1e-6
      return out.every((v) => v >= lo - eps && v <= hi + eps)
    })
  })
})

describe('BlockChunker (PBT)', () => {
  it('conservation: pushed samples reappear as a prefix, tail zero-padded on flush', () => {
    runProperty('chunker/sample-conservation', pcmChunks, (chunks) => {
      const chunker = new BlockChunker(BLOCK_SAMPLES)
      const emitted: Float32Array[] = []
      for (const c of chunks) emitted.push(...chunker.push(c))
      const tail = chunker.flush()
      if (tail) emitted.push(tail)
      const input = concat(chunks)
      const out = concat(emitted)
      if (out.length % BLOCK_SAMPLES !== 0) return false
      if (out.length < input.length) return false
      for (let i = 0; i < input.length; i++) if (!Object.is(out[i], input[i])) return false
      for (let i = input.length; i < out.length; i++) if (out[i] !== 0) return false
      return true
    })
  })

  it('every emitted block is exactly BLOCK_SAMPLES wide', () => {
    runProperty('chunker/block-width', pcmChunks, (chunks) => {
      const chunker = new BlockChunker(BLOCK_SAMPLES)
      for (const c of chunks) for (const b of chunker.push(c)) if (b.length !== BLOCK_SAMPLES) return false
      const tail = chunker.flush()
      return tail === null || tail.length === BLOCK_SAMPLES
    })
  })
})
