import type { TranscriptEvent } from './types'

export interface TranscriptSegment {
  text: string
  at: number
}

export interface RollingTranscriptView {
  text: string
  segmentCount: number
  livePartial: string
}

export class RollingTranscript {
  private segments: TranscriptSegment[] = []
  private live = ''

  push(event: TranscriptEvent, at: number): void {
    const text = event.text.trim()
    if (event.isFinal) {
      if (text) this.segments.push({ text, at })
      this.live = ''
    } else {
      this.live = text
    }
  }

  reset(): void {
    this.segments = []
    this.live = ''
  }

  get segmentCount(): number {
    return this.segments.length
  }

  full(): RollingTranscriptView {
    return this.view(this.segments)
  }

  recent(windowMs: number, now: number): RollingTranscriptView {
    const cutoff = now - windowMs
    return this.view(this.segments.filter((s) => s.at >= cutoff))
  }

  private view(segments: TranscriptSegment[]): RollingTranscriptView {
    const parts = segments.map((s) => s.text)
    if (this.live) parts.push(this.live)
    return { text: parts.join(' '), segmentCount: segments.length, livePartial: this.live }
  }
}
