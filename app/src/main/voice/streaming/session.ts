import { FrameSource, defaultFrameSourceConfig } from './frame-source'
import type { FrameSourceConfig } from './frame-source'
import type { VadEvent } from './types'

export interface StreamSessionEvent {
  kind: VadEvent
  dropped: number
}

export type StreamSessionSink = (event: StreamSessionEvent) => void

export class VoiceStreamSession {
  private readonly source: FrameSource
  private closed = false

  constructor(
    private readonly sink: StreamSessionSink,
    config: FrameSourceConfig = defaultFrameSourceConfig()
  ) {
    this.source = new FrameSource(config)
  }

  pushFrames(samples: Float32Array): void {
    if (this.closed) return
    const { events, dropped } = this.source.ingest(samples)
    for (const kind of events) this.sink({ kind, dropped })
  }

  get inUtterance(): boolean {
    return this.source.inUtterance
  }

  get droppedSamples(): number {
    return this.source.droppedSamples
  }

  reset(): void {
    this.source.reset()
  }

  close(): void {
    this.closed = true
    this.source.reset()
  }
}
