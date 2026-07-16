import { SAMPLE_RATE } from './types'

export interface WindowConfig {
  sampleRate: number
  decodeIntervalSamples: number
  maxWindowSamples: number
}

export function defaultWindowConfig(overrides: Partial<WindowConfig> = {}): WindowConfig {
  return {
    sampleRate: SAMPLE_RATE,
    decodeIntervalSamples: SAMPLE_RATE, // re-decode after each ~1s of fresh audio
    maxWindowSamples: SAMPLE_RATE * 30, // bound decode cost; older audio is dropped from the window
    ...overrides
  }
}

// Whisper is batch-only, so streaming = re-decode a growing window on a cadence and stabilize the
// output downstream (LocalAgreement). This buffers frames and reports when enough fresh audio has
// arrived to be worth another decode, capping window length so per-decode cost stays bounded.
export class StreamWindow {
  private buffer: Float32Array[] = []
  private total = 0
  private sinceDecode = 0

  constructor(private readonly config: WindowConfig = defaultWindowConfig()) {}

  append(frame: Float32Array): void {
    this.buffer.push(frame)
    this.total += frame.length
    this.sinceDecode += frame.length
    this.trim()
  }

  shouldDecode(): boolean {
    return this.sinceDecode >= this.config.decodeIntervalSamples && this.total > 0
  }

  window(): Float32Array {
    const out = new Float32Array(this.total)
    let offset = 0
    for (const chunk of this.buffer) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }

  markDecoded(): void {
    this.sinceDecode = 0
  }

  get windowMs(): number {
    return (this.total / this.config.sampleRate) * 1000
  }

  reset(): void {
    this.buffer = []
    this.total = 0
    this.sinceDecode = 0
  }

  private trim(): void {
    while (this.total - this.buffer[0].length >= this.config.maxWindowSamples) {
      this.total -= this.buffer.shift()!.length
    }
  }
}

export class RtfMeter {
  private audioMs = 0
  private decodeMs = 0
  private worst = 0

  record(windowMs: number, elapsedMs: number): void {
    this.audioMs += windowMs
    this.decodeMs += elapsedMs
    const rtf = windowMs === 0 ? 0 : elapsedMs / windowMs
    if (rtf > this.worst) this.worst = rtf
  }

  get meanRtf(): number {
    return this.audioMs === 0 ? 0 : this.decodeMs / this.audioMs
  }

  get worstRtf(): number {
    return this.worst
  }

  get realTime(): boolean {
    return this.worst < 1
  }

  reset(): void {
    this.audioMs = 0
    this.decodeMs = 0
    this.worst = 0
  }
}
