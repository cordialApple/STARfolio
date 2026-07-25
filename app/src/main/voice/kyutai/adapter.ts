import type { TranscriptEvent } from '../streaming/types'
import { SAMPLE_RATE } from '../streaming/types'
import { BLOCK_SAMPLES, STT_SAMPLE_RATE } from './protocol'
import { decodeOutMsg, encodeInMsg } from './codec'
import { BlockChunker, LinearResampler } from './resample'
import { TranscriptAssembler, type WordTiming } from './mapping'
import type { SttTransport } from './transport'

export interface KyutaiAdapterOptions {
  transport: SttTransport
  onTranscript: (event: TranscriptEvent) => void
  inputRate?: number
  onEndOfTurn?: () => void
  onWord?: (word: WordTiming) => void
  onReady?: () => void
  onError?: (message: string) => void
  onDrained?: (markerId: number) => void
}

export class KyutaiSttAdapter {
  private readonly transport: SttTransport
  private readonly resampler: LinearResampler
  private readonly chunker = new BlockChunker(BLOCK_SAMPLES)
  private readonly assembler: TranscriptAssembler
  private ready = false
  private pending: Uint8Array[] = []
  private markerSeq = 0

  constructor(opts: KyutaiAdapterOptions) {
    this.transport = opts.transport
    this.resampler = new LinearResampler(opts.inputRate ?? SAMPLE_RATE, STT_SAMPLE_RATE)
    this.assembler = new TranscriptAssembler({
      onTranscript: opts.onTranscript,
      onEndOfTurn: opts.onEndOfTurn,
      onWord: opts.onWord,
      onError: opts.onError,
      onDrained: opts.onDrained,
      onReady: () => {
        this.ready = true
        for (const bytes of this.pending) this.transport.send(bytes)
        this.pending = []
        opts.onReady?.()
      }
    })
    this.transport.onMessage((bytes) => this.assembler.handle(decodeOutMsg(bytes)))
    this.transport.onError((err) => opts.onError?.(err.message))
  }

  pushFrames(frames: Float32Array): void {
    const resampled = this.resampler.process(frames)
    for (const block of this.chunker.push(resampled)) this.sendAudio(block)
  }

  finish(): number {
    const tail = this.chunker.flush()
    if (tail) this.sendAudio(tail)
    const id = this.markerSeq++
    this.send(encodeInMsg({ type: 'Marker', id }))
    return id
  }

  reset(): void {
    this.assembler.reset()
    this.resampler.reset()
    this.chunker.reset()
  }

  close(): void {
    this.transport.close()
  }

  private sendAudio(block: Float32Array): void {
    this.send(encodeInMsg({ type: 'Audio', pcm: Array.from(block) }))
  }

  private send(bytes: Uint8Array): void {
    if (this.ready) this.transport.send(bytes)
    else this.pending.push(bytes)
  }
}
