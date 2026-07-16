import { FrameSource, defaultFrameSourceConfig } from './frame-source'
import type { FrameSourceConfig } from './frame-source'
import { StreamDecoder } from './stream-decoder'
import type { DecodeFn, TranscriptSink } from './stream-decoder'
import type { WindowConfig } from './window'
import type { VadEvent } from './types'

export interface StreamSessionEvent {
  kind: VadEvent
  dropped: number
}

export type StreamSessionSink = (event: StreamSessionEvent) => void

export interface StreamSessionOptions {
  decode?: DecodeFn
  onTranscript?: TranscriptSink
  window?: WindowConfig
}

export class VoiceStreamSession {
  private readonly source: FrameSource
  private readonly decoder: StreamDecoder | null
  private closed = false

  constructor(
    private readonly sink: StreamSessionSink,
    config: FrameSourceConfig = defaultFrameSourceConfig(),
    opts: StreamSessionOptions = {}
  ) {
    this.decoder =
      opts.decode && opts.onTranscript
        ? new StreamDecoder(opts.decode, opts.onTranscript, opts.window)
        : null
    this.source = new FrameSource(
      config,
      this.decoder ? (frame, events) => this.decoder!.onFrame(frame, events) : undefined
    )
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
    this.decoder?.reset()
  }

  close(): void {
    this.closed = true
    this.source.reset()
    this.decoder?.reset()
  }
}
