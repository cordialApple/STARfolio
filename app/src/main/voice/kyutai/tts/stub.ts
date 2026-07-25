import { decode, encode } from '@msgpack/msgpack'
import type { CloseInfo, SttTransport } from '../transport'
import type { TtsOutMsg } from './protocol'

export class StubTtsTransport implements SttTransport {
  private messageCb: (bytes: Uint8Array) => void = () => {}
  private closeCb: (info: CloseInfo) => void = () => {}

  constructor() {
    queueMicrotask(() => this.out({ type: 'Ready' }))
  }

  send(bytes: Uint8Array): void {
    const msg = decode(bytes) as { type: string; id?: number; text?: string }
    if (msg.type === 'Text') {
      const samples = Math.max(1, (msg.text ?? '').length) * 240
      this.out({ type: 'Audio', pcm: new Array(samples).fill(0) })
    } else if (msg.type === 'Marker') {
      this.out({ type: 'Marker', id: msg.id ?? 0 })
    }
  }

  onMessage(cb: (bytes: Uint8Array) => void): void {
    this.messageCb = cb
  }
  onOpen(): void {}
  onClose(cb: (info: CloseInfo) => void): void {
    this.closeCb = cb
  }
  onError(): void {}
  close(): void {
    this.closeCb({})
  }

  private out(msg: TtsOutMsg): void {
    const bytes = encode(msg)
    queueMicrotask(() => this.messageCb(bytes))
  }
}
