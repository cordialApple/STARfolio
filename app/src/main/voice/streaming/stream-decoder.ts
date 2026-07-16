import { StreamWindow, defaultWindowConfig } from './window'
import type { WindowConfig } from './window'
import { LocalAgreement } from './local-agreement'
import type { TranscriptEvent, VadEvent } from './types'

export type DecodeFn = (samples: Float32Array) => Promise<string>
export type TranscriptSink = (event: TranscriptEvent) => void

interface Turn {
  window: StreamWindow
  agreement: LocalAgreement
}

export class StreamDecoder {
  private turn: Turn | null = null
  private chain: Promise<void> = Promise.resolve()
  private busy = false

  constructor(
    private readonly decode: DecodeFn,
    private readonly emit: TranscriptSink,
    private readonly config: WindowConfig = defaultWindowConfig()
  ) {}

  onFrame(frame: Float32Array, events: VadEvent[]): void {
    if (events.includes('utteranceStart')) this.begin()
    if (this.turn) this.turn.window.append(frame)
    if (events.includes('utteranceEnd')) {
      this.finish()
      return
    }
    if (this.turn && this.turn.window.shouldDecode()) this.run(this.turn, false)
  }

  get inTurn(): boolean {
    return this.turn !== null
  }

  reset(): void {
    this.turn = null
    this.busy = false
    this.chain = Promise.resolve()
  }

  drain(): Promise<void> {
    return this.chain
  }

  private begin(): void {
    this.turn = { window: new StreamWindow(this.config), agreement: new LocalAgreement() }
  }

  private finish(): void {
    const turn = this.turn
    if (!turn) return
    this.turn = null
    this.run(turn, true)
  }

  private run(turn: Turn, isFinal: boolean): void {
    // Single-flight: while a decode is in flight, drop intermediate partials and let the window keep
    // growing — the next free decode picks up the freshest audio. Finals always run.
    if (!isFinal && this.busy) return
    const audio = turn.window.window()
    turn.window.markDecoded()
    this.busy = true
    this.chain = this.chain
      .then(async () => {
        const text = audio.length ? await this.decode(audio) : ''
        const partial = isFinal ? turn.agreement.finalize(text) : turn.agreement.update(text)
        this.emit({ text: partial.text, stableUpTo: partial.stableUpTo, isFinal })
      })
      .catch(() => {})
      .finally(() => {
        this.busy = false
      })
  }
}
