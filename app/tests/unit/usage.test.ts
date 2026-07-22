import { beforeEach, describe, expect, it } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { logUsage, usageSummary } from '../../src/main/ai/usage'

beforeEach(() => {
  initDb(':memory:')
})

describe('usageSummary', () => {
  it('is empty on a fresh store', () => {
    expect(usageSummary()).toEqual({ byFeature: [], totalCost: 0, totalCalls: 0 })
  })

  it('round-trips a logged call and prices a known model', () => {
    logUsage('claude-haiku-4-5', { in: 1000, out: 200, cacheRead: 5000 }, 'parse')
    const s = usageSummary()
    expect(s.totalCalls).toBe(1)
    expect(s.byFeature).toHaveLength(1)
    expect(s.byFeature[0]).toMatchObject({
      feature: 'parse',
      calls: 1,
      inTokens: 1000,
      outTokens: 200,
      cacheReadTokens: 5000
    })
    expect(s.byFeature[0].cost).toBeCloseTo(0.0025, 10)
    expect(s.totalCost).toBeCloseTo(0.0025, 10)
  })

  it('falls back to sonnet pricing for an unknown model', () => {
    logUsage('made-up-model', { in: 1_000_000, out: 0, cacheRead: 0 }, 'parse')
    expect(usageSummary().totalCost).toBeCloseTo(3, 10)
  })

  it('prices openai- and gemini-prefixed models at zero', () => {
    logUsage('openai:qwen2.5', { in: 5_000_000, out: 2_000_000, cacheRead: 1_000_000 }, 'local')
    logUsage('gemini:gemini-2.0-flash', { in: 3_000_000, out: 1_000_000, cacheRead: 0 }, 'local')
    const s = usageSummary()
    expect(s.totalCost).toBe(0)
    expect(s.totalCalls).toBe(2)
  })

  it('merges one feature across two models and sums cost', () => {
    logUsage('claude-haiku-4-5', { in: 1_000_000, out: 0, cacheRead: 0 }, 'parse')
    logUsage('claude-sonnet-5', { in: 1_000_000, out: 0, cacheRead: 0 }, 'parse')
    const s = usageSummary()
    expect(s.byFeature).toHaveLength(1)
    expect(s.byFeature[0].calls).toBe(2)
    expect(s.byFeature[0].inTokens).toBe(2_000_000)
    expect(s.byFeature[0].cost).toBeCloseTo(4, 10)
  })

  it('sorts features by descending cost', () => {
    logUsage('claude-haiku-4-5', { in: 1_000_000, out: 0, cacheRead: 0 }, 'cheap')
    logUsage('claude-sonnet-5', { in: 1_000_000, out: 0, cacheRead: 0 }, 'pricey')
    expect(usageSummary().byFeature.map((f) => f.feature)).toEqual(['pricey', 'cheap'])
  })
})
