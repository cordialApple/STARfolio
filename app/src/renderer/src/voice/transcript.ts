import type { TranscriptEvent } from '../lib/bank-types'

export interface SplitTranscript {
  stable: string
  tail: string
}

export function splitTranscript(event: TranscriptEvent | null): SplitTranscript {
  if (!event) return { stable: '', tail: '' }
  const at = Math.max(0, Math.min(event.stableUpTo, event.text.length))
  return { stable: event.text.slice(0, at), tail: event.text.slice(at) }
}
