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
