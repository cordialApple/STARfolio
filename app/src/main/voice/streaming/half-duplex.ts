export interface HalfDuplexConfig {
  guardMs: number
}

export function defaultHalfDuplexConfig(overrides: Partial<HalfDuplexConfig> = {}): HalfDuplexConfig {
  // Keep capture muted for a beat after TTS stops so the room's echo tail decays before the mic
  // reopens — otherwise whisper transcribes the interviewer's own trailing question.
  return { guardMs: 250, ...overrides }
}

export class HalfDuplexGate {
  private speaking = false
  private releaseAt = 0

  constructor(private readonly config: HalfDuplexConfig = defaultHalfDuplexConfig()) {}

  onTtsStart(): void {
    this.speaking = true
  }

  onTtsEnd(now: number): void {
    this.speaking = false
    this.releaseAt = now + this.config.guardMs
  }

  captureOpen(now: number): boolean {
    return !this.speaking && now >= this.releaseAt
  }

  reset(): void {
    this.speaking = false
    this.releaseAt = 0
  }
}
