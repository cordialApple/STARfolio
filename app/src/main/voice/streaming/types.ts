export const SAMPLE_RATE = 16000

export interface TranscriptEvent {
  text: string
  stableUpTo: number
  isFinal: boolean
}

export type VadEvent = 'utteranceStart' | 'utteranceEnd'
