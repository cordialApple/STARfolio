import type { SttTransport } from '../transport'
import { decodeTtsOut, encodeTtsIn } from './codec'
import type { TtsOutMsg } from './protocol'

export interface KyutaiTtsAdapterOptions {
  transport: SttTransport
  onAudio: (pcm: Float32Array) => void
  onStart?: () => void
  onEnd?: (markerId: number) => void
  onReady?: () => void
  onError?: (message: string) => void
}

export class KyutaiTtsAdapter {
  private readonly transport: SttTransport
  private ready = false
  private started = false
  private pending: Uint8Array[] = []
  private markerSeq = 0

  constructor(private readonly opts: KyutaiTtsAdapterOptions) {
    this.transport = opts.transport
    this.transport.onMessage((bytes) => this.handle(decodeTtsOut(bytes)))
    this.transport.onError((err) => opts.onError?.(err.message))
  }

  speak(text: string): void {
    this.send(encodeTtsIn({ type: 'Text', text }))
  }

  finish(): number {
    const id = this.markerSeq++
    this.send(encodeTtsIn({ type: 'Marker', id }))
    return id
  }

  reset(): void {
    this.started = false
    this.pending = []
  }

  close(): void {
    this.transport.close()
  }

  private handle(msg: TtsOutMsg): void {
    switch (msg.type) {
      case 'Ready':
        this.ready = true
        for (const bytes of this.pending) this.transport.send(bytes)
        this.pending = []
        this.opts.onReady?.()
        break
      case 'Audio':
        if (!this.started) {
          this.started = true
          this.opts.onStart?.()
        }
        this.opts.onAudio(Float32Array.from(msg.pcm))
        break
      case 'Marker':
        this.opts.onEnd?.(msg.id)
        break
      case 'Error':
        this.opts.onError?.(msg.message)
        break
    }
  }

  private send(bytes: Uint8Array): void {
    if (this.ready) this.transport.send(bytes)
    else this.pending.push(bytes)
  }
}
