import type { TranscriptEvent } from '../streaming/types'
import { isEndOfTurn, type OutMsg } from './protocol'

export interface WordTiming {
  text: string
  startTime: number
}

export interface AssemblerSinks {
  onTranscript: (event: TranscriptEvent) => void
  onEndOfTurn?: () => void
  onWord?: (word: WordTiming) => void
  onReady?: () => void
  onError?: (message: string) => void
  onDrained?: (markerId: number) => void
}

export class TranscriptAssembler {
  private words: string[] = []

  constructor(private readonly sinks: AssemblerSinks) {}

  reset(): void {
    this.words = []
  }

  private text(): string {
    return this.words.join(' ')
  }

  private emit(isFinal: boolean): void {
    const text = this.text()
    this.sinks.onTranscript({ text, stableUpTo: text.length, isFinal })
  }

  handle(msg: OutMsg): void {
    switch (msg.type) {
      case 'Ready':
        this.sinks.onReady?.()
        return
      case 'Word':
        this.words.push(msg.text)
        this.sinks.onWord?.({ text: msg.text, startTime: msg.start_time })
        this.emit(false)
        return
      case 'Step':
        if (isEndOfTurn(msg) && this.words.length > 0) {
          this.emit(true)
          this.reset()
          this.sinks.onEndOfTurn?.()
        }
        return
      case 'Marker':
        this.sinks.onDrained?.(msg.id)
        return
      case 'Error':
        this.sinks.onError?.(msg.message)
        return
      case 'EndWord':
        return
    }
  }
}
