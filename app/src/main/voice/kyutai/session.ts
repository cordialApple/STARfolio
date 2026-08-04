import type { TranscriptEvent, VadEvent } from '../streaming/types'
import { HalfDuplexGate, defaultHalfDuplexConfig } from '../streaming/half-duplex'
import type { HalfDuplexConfig } from '../streaming/half-duplex'
import { KyutaiSttAdapter } from './adapter'
import { createTransport } from './factory'
import type { SttTransport } from './transport'

export interface KyutaiSessionEvent {
  kind: VadEvent
  dropped: number
}

export type KyutaiUtteranceSink = (event: KyutaiSessionEvent) => void

export interface KyutaiVoiceSessionOptions {
  onTranscript: (event: TranscriptEvent) => void
  onError?: (message: string) => void
  transport?: SttTransport
  halfDuplex?: HalfDuplexConfig
  now?: () => number
}

export class KyutaiVoiceSession {
  private readonly gate: HalfDuplexGate
  private readonly adapter: KyutaiSttAdapter
  private readonly now: () => number
  private active = false
  private closed = false

  constructor(
    private readonly sink: KyutaiUtteranceSink,
    opts: KyutaiVoiceSessionOptions
  ) {
    this.gate = new HalfDuplexGate(opts.halfDuplex ?? defaultHalfDuplexConfig())
    this.now = opts.now ?? (() => Date.now())
    this.adapter = new KyutaiSttAdapter({
      transport: opts.transport ?? createTransport(),
      onTranscript: opts.onTranscript,
      onError: opts.onError,
      onWord: () => this.markActive(),
      onEndOfTurn: () => this.markIdle()
    })
  }

  pushFrames(frames: Float32Array): void {
    if (this.closed || !this.gate.isCaptureOpen(this.now())) return
    this.adapter.pushFrames(frames)
  }

  onTtsStart(): void {
    this.gate.onTtsStart()
    this.adapter.reset()
    this.active = false
  }

  onTtsEnd(): void {
    this.gate.onTtsEnd(this.now())
  }

  close(): void {
    this.closed = true
    this.adapter.close()
  }

  private markActive(): void {
    if (this.active) return
    this.active = true
    this.sink({ kind: 'utteranceStart', dropped: 0 })
  }

  private markIdle(): void {
    if (!this.active) return
    this.active = false
    this.sink({ kind: 'utteranceEnd', dropped: 0 })
  }
}
