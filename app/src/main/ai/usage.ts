import { randomUUID } from 'crypto'
import { getDb } from '../db/client'

export interface TokenUsage {
  in: number
  out: number
  cacheRead: number
}

export function logUsage(model: string, usage: TokenUsage, feature: string): void {
  try {
    getDb()
      .prepare(
        'INSERT INTO usage_log (id, model, in_tokens, out_tokens, cache_read_tokens, feature) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(randomUUID(), model, usage.in, usage.out, usage.cacheRead, feature)
  } catch {
    // usage logging is best-effort telemetry; never let it break an AI response
  }
}

interface ModelPricing {
  in: number
  out: number
  cacheRead: number
}

const PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1 },
  'claude-sonnet-5': { in: 3, out: 15, cacheRead: 0.3 }
}

const FALLBACK_PRICING: ModelPricing = { in: 3, out: 15, cacheRead: 0.3 }

const ZERO_PRICING: ModelPricing = { in: 0, out: 0, cacheRead: 0 }

function pricingFor(model: string): ModelPricing {
  if (model.startsWith('openai:') || model.startsWith('gemini:')) return ZERO_PRICING
  return PRICING[model] ?? FALLBACK_PRICING
}

export interface FeatureSpend {
  feature: string
  calls: number
  inTokens: number
  outTokens: number
  cacheReadTokens: number
  cost: number
}

export interface UsageSummary {
  byFeature: FeatureSpend[]
  totalCost: number
  totalCalls: number
}

interface UsageRow {
  feature: string
  model: string
  calls: number
  inTok: number
  outTok: number
  cacheTok: number
}

export function usageSummary(): UsageSummary {
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(feature, 'other') AS feature, COALESCE(model, '') AS model,
              COUNT(*) AS calls,
              SUM(in_tokens) AS inTok,
              SUM(out_tokens) AS outTok,
              SUM(cache_read_tokens) AS cacheTok
         FROM usage_log
        GROUP BY feature, model`
    )
    .all() as UsageRow[]

  const byFeatureMap = new Map<string, FeatureSpend>()
  let totalCost = 0
  let totalCalls = 0
  for (const r of rows) {
    const p = pricingFor(r.model)
    const cost = (r.inTok * p.in + r.outTok * p.out + r.cacheTok * p.cacheRead) / 1e6
    let cur = byFeatureMap.get(r.feature)
    if (!cur) {
      cur = { feature: r.feature, calls: 0, inTokens: 0, outTokens: 0, cacheReadTokens: 0, cost: 0 }
      byFeatureMap.set(r.feature, cur)
    }
    cur.calls += r.calls
    cur.inTokens += r.inTok
    cur.outTokens += r.outTok
    cur.cacheReadTokens += r.cacheTok
    cur.cost += cost
    totalCost += cost
    totalCalls += r.calls
  }

  const byFeature = [...byFeatureMap.values()].sort((a, b) => b.cost - a.cost)
  return { byFeature, totalCost, totalCalls }
}
