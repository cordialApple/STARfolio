export interface UtteranceStreamDeps {
  now?: () => number
}

export interface UtterancePartial {
  text: string
  done: boolean
}

export class UtteranceStream {
  private buf = ''
  private sealed = false
  private started = false
  private updatedAtMs = 0
  private readonly now: () => number

  constructor(deps: UtteranceStreamDeps = {}) {
    this.now = deps.now ?? Date.now
  }

  push(token: string): UtterancePartial {
    if (this.sealed || !token) return this.snapshot()
    this.buf += token
    this.started = true
    this.updatedAtMs = this.now()
    return this.snapshot()
  }

  finish(): UtterancePartial {
    this.sealed = true
    return this.snapshot()
  }

  reset(): void {
    this.buf = ''
    this.sealed = false
    this.started = false
    this.updatedAtMs = 0
  }

  text(): string {
    return this.buf.trim()
  }

  get done(): boolean {
    return this.sealed
  }

  get hasStarted(): boolean {
    return this.started
  }

  // ms since the last token (0 before the first). Lets a driver time out a stream
  // that started then stalled, leaving the candidate on a half-finished question.
  idleMs(now: number): number {
    return this.started ? now - this.updatedAtMs : 0
  }

  // Trimmed to match composeUtterance's `out.text.trim()` contract, so the sealed
  // stream persists byte-identical to the non-streamed parse path.
  private snapshot(): UtterancePartial {
    return { text: this.buf.trim(), done: this.sealed }
  }
}
