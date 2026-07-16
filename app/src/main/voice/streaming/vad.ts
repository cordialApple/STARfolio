import { SAMPLE_RATE, type VadConfig, type VadEvent } from './types'

export function defaultVadConfig(overrides: Partial<VadConfig> = {}): VadConfig {
  return {
    sampleRate: SAMPLE_RATE,
    frameSamples: 512,
    energyThreshold: 0.0125,
    minSpeechFrames: 4,
    // Generous by design: interview answers pause to think. ~1.3s of silence ends the turn
    // so a mid-answer beat never cuts the speaker off.
    hangoverFrames: 40,
    ...overrides
  }
}

export function frameRms(frame: Float32Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / frame.length)
}

export class EnergyVad {
  private active = false
  private speechRun = 0
  private silenceRun = 0

  constructor(private readonly config: VadConfig = defaultVadConfig()) {}

  process(frame: Float32Array): VadEvent[] {
    const speech = frameRms(frame) >= this.config.energyThreshold
    if (!this.active) {
      if (speech) {
        this.speechRun++
        if (this.speechRun >= this.config.minSpeechFrames) {
          this.active = true
          this.speechRun = 0
          this.silenceRun = 0
          return ['utteranceStart']
        }
      } else {
        this.speechRun = 0
      }
      return []
    }
    if (speech) {
      this.silenceRun = 0
      return []
    }
    this.silenceRun++
    if (this.silenceRun >= this.config.hangoverFrames) {
      this.active = false
      this.silenceRun = 0
      return ['utteranceEnd']
    }
    return []
  }

  get inUtterance(): boolean {
    return this.active
  }

  reset(): void {
    this.active = false
    this.speechRun = 0
    this.silenceRun = 0
  }
}
