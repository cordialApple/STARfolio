import { describe, expect, it } from 'vitest'
import {
  StreamWindow,
  RtfMeter,
  withinBudget,
  STREAM_BUDGETS,
  projectedChunkLatencyMs,
  CHUNK_LATENCY_CEILING_MS,
  type StreamModel
} from '../../src/main/voice/streaming'

function frame(value: number, n = 16000): Float32Array {
  return new Float32Array(n).fill(value)
}

function runBudgetLoop(ticks: number, rtf: number): RtfMeter {
  const win = new StreamWindow()
  const meter = new RtfMeter()
  for (let t = 0; t < ticks; t++) {
    win.append(frame(0.1, 16000))
    expect(win.shouldDecode()).toBe(true)
    const windowMs = win.windowMs
    meter.record(windowMs, windowMs * rtf)
    win.markDecoded()
    expect(win.shouldDecode()).toBe(false)
  }
  return meter
}

const MODELS: StreamModel[] = ['tiny.en', 'base.en', 'small.en']

describe('streaming budget pipeline: per-tier rtf ceilings over a 1s-tick decode loop', () => {
  it('keeps each tier within budget and real-time when it decodes at its ceiling rtf', () => {
    for (const model of MODELS) {
      const meter = runBudgetLoop(8, STREAM_BUDGETS[model].rtfCeiling)
      expect(meter.worstRtf).toBeCloseTo(STREAM_BUDGETS[model].rtfCeiling)
      expect(withinBudget(model, meter)).toBe(true)
      expect(meter.realTime).toBe(true)
    }
  })

  it('fails the tighter budget when rtf exceeds the ceiling but still clears the raw real-time bar', () => {
    const meter = runBudgetLoop(8, 0.85)
    expect(meter.worstRtf).toBeCloseTo(0.85)
    expect(meter.worstRtf).toBeGreaterThan(STREAM_BUDGETS['base.en'].rtfCeiling)
    expect(withinBudget('base.en', meter)).toBe(false)
    expect(meter.realTime).toBe(true)
  })

  it('fails every tier and loses real-time when decode is slower than real-time', () => {
    const meter = runBudgetLoop(8, 1.2)
    expect(meter.worstRtf).toBeCloseTo(1.2)
    expect(meter.realTime).toBe(false)
    for (const model of MODELS) {
      expect(withinBudget(model, meter)).toBe(false)
    }
  })

  it('projects a chunk latency under the ceiling for an in-budget base.en loop', () => {
    const meter = runBudgetLoop(8, STREAM_BUDGETS['base.en'].rtfCeiling)
    expect(withinBudget('base.en', meter)).toBe(true)
    expect(projectedChunkLatencyMs(meter.worstRtf)).toBeLessThanOrEqual(CHUNK_LATENCY_CEILING_MS)
  })
})
