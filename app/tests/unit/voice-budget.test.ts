import { describe, expect, it } from 'vitest'
import {
  STREAM_BUDGETS,
  STREAM_DEFAULT_MODEL,
  CHUNK_LATENCY_CEILING_MS,
  DECODE_INTERVAL_MS,
  ENDPOINT_HANGOVER_MS,
  projectedChunkLatencyMs,
  withinBudget
} from '../../src/main/voice/streaming'

const models = Object.keys(STREAM_BUDGETS) as Array<keyof typeof STREAM_BUDGETS>

describe('STREAM_BUDGETS', () => {
  it('defaults to base.en', () => {
    expect(STREAM_DEFAULT_MODEL).toBe('base.en')
  })

  it('keeps every rtfCeiling under the hard real-time bound with a boolean readiness', () => {
    for (const model of models) {
      const budget = STREAM_BUDGETS[model]
      expect(budget.rtfCeiling).toBeLessThan(1.0)
      expect(typeof budget.streamingReady).toBe('boolean')
    }
  })

  it('keeps each tier ceiling within the chunk latency budget', () => {
    for (const model of models) {
      expect(projectedChunkLatencyMs(STREAM_BUDGETS[model].rtfCeiling)).toBeLessThanOrEqual(
        CHUNK_LATENCY_CEILING_MS
      )
    }
  })

  it('marks the fast tiers streaming-ready and the heavy tier not', () => {
    expect(STREAM_BUDGETS['tiny.en'].streamingReady).toBe(true)
    expect(STREAM_BUDGETS['base.en'].streamingReady).toBe(true)
    expect(STREAM_BUDGETS['small.en'].streamingReady).toBe(false)
  })
})

describe('projectedChunkLatencyMs', () => {
  it('is the interval at zero rtf', () => {
    expect(projectedChunkLatencyMs(0)).toBe(DECODE_INTERVAL_MS)
  })

  it('scales linearly with rtf', () => {
    expect(projectedChunkLatencyMs(0.5)).toBe(1500)
  })

  it('clamps negative rtf to the interval', () => {
    expect(projectedChunkLatencyMs(-1)).toBe(DECODE_INTERVAL_MS)
  })

  it('respects a custom interval', () => {
    expect(projectedChunkLatencyMs(1, 500)).toBe(1000)
  })
})

describe('withinBudget', () => {
  it('passes a meter sitting exactly at the tier ceiling', () => {
    for (const model of models) {
      expect(withinBudget(model, { worstRtf: STREAM_BUDGETS[model].rtfCeiling })).toBe(true)
    }
  })

  it('fails a meter just above the tier ceiling', () => {
    for (const model of models) {
      expect(withinBudget(model, { worstRtf: STREAM_BUDGETS[model].rtfCeiling + 0.001 })).toBe(false)
    }
  })

  it('passes a fast meter for every tier', () => {
    for (const model of models) {
      expect(withinBudget(model, { worstRtf: 0.3 })).toBe(true)
    }
  })

  it('fails on the latency gate when a tier ceiling would clear it', () => {
    expect(withinBudget('small.en', { worstRtf: 0.96 })).toBe(false)
    expect(projectedChunkLatencyMs(1.1)).toBeGreaterThan(CHUNK_LATENCY_CEILING_MS)
  })
})

describe('config-derived constants', () => {
  it('pins the endpoint hangover and decode interval', () => {
    expect(ENDPOINT_HANGOVER_MS).toBe(1280)
    expect(DECODE_INTERVAL_MS).toBe(1000)
  })
})
