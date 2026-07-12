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
