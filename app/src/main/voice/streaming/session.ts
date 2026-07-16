import { FrameSource, defaultFrameSourceConfig } from './frame-source'
import type { FrameSourceConfig } from './frame-source'
import { StreamDecoder } from './stream-decoder'
import type { DecodeFn, TranscriptSink } from './stream-decoder'
import { HalfDuplexGate, defaultHalfDuplexConfig } from './half-duplex'
import type { HalfDuplexConfig } from './half-duplex'
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
  halfDuplex?: HalfDuplexConfig
  now?: () => number
}

export class VoiceStreamSession {
  private readonly source: FrameSource
  private readonly decoder: StreamDecoder | null
  private readonly gate: HalfDuplexGate
  private readonly now: () => number
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
    this.gate = new HalfDuplexGate(opts.halfDuplex ?? defaultHalfDuplexConfig())
    this.now = opts.now ?? (() => Date.now())
  }

  pushFrames(samples: Float32Array): void {
    if (this.closed || !this.gate.captureOpen(this.now())) return
    const { events, dropped } = this.source.ingest(samples)
    for (const kind of events) this.sink({ kind, dropped })
  }

  onTtsStart(): void {
    this.gate.onTtsStart()
    this.resetPipeline()
  }

  onTtsEnd(): void {
    this.gate.onTtsEnd(this.now())
  }

  get inUtterance(): boolean {
    return this.source.inUtterance
  }

  get droppedSamples(): number {
    return this.source.droppedSamples
  }

  reset(): void {
    this.resetPipeline()
    this.gate.reset()
  }

  close(): void {
    this.closed = true
    this.resetPipeline()
    this.gate.reset()
  }

  private resetPipeline(): void {
    this.source.reset()
    this.decoder?.reset()
  }
}
