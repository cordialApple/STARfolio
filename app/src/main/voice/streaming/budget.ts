export type StreamModel = 'tiny.en' | 'base.en' | 'small.en'

export const DECODE_INTERVAL_MS = 1000
export const ENDPOINT_HANGOVER_MS = 1280
export const CHUNK_LATENCY_CEILING_MS = 2000

export interface StreamBudget {
  rtfCeiling: number
  streamingReady: boolean
}

export const STREAM_DEFAULT_MODEL: StreamModel = 'base.en'

export const STREAM_BUDGETS: Record<StreamModel, StreamBudget> = {
  'tiny.en': { rtfCeiling: 0.5, streamingReady: true },
  'base.en': { rtfCeiling: 0.7, streamingReady: true },
  // Near the ceiling: only sustains on faster target hardware, so not the streaming default.
  'small.en': { rtfCeiling: 0.95, streamingReady: false }
}

export function projectedChunkLatencyMs(rtf: number, intervalMs = DECODE_INTERVAL_MS): number {
  return intervalMs * (1 + Math.max(0, rtf))
}

export function withinBudget(model: StreamModel, meter: { worstRtf: number }): boolean {
  return (
    meter.worstRtf <= STREAM_BUDGETS[model].rtfCeiling &&
    projectedChunkLatencyMs(meter.worstRtf) <= CHUNK_LATENCY_CEILING_MS
  )
}
