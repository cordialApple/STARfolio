export const SAMPLE_RATE = 16000

export interface PartialTranscript {
  text: string
  stableUpTo: number
}

export interface TranscriptEvent {
  text: string
  stableUpTo: number
  isFinal: boolean
}

export type VadEvent = 'utteranceStart' | 'utteranceEnd'

export interface VadConfig {
  sampleRate: number
  frameSamples: number
  energyThreshold: number
  minSpeechFrames: number
  hangoverFrames: number
}
