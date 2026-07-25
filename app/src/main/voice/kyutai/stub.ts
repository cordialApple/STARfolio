import { decode, encode } from '@msgpack/msgpack'
import type { OutMsg } from './protocol'
import { eotPrs } from './protocol'
import type { CloseInfo, SttTransport } from './transport'

const SCRIPT = ['tell', 'me', 'about', 'a', 'time']

export class StubTransport implements SttTransport {
  private messageCb: (bytes: Uint8Array) => void = () => {}
  private closeCb: (info: CloseInfo) => void = () => {}
  private spoken = 0
  private t = 0

  constructor() {
    queueMicrotask(() => this.out({ type: 'Ready' }))
  }

  send(bytes: Uint8Array): void {
    const msg = decode(bytes) as { type: string; id?: number }
    if (msg.type === 'Audio' && this.spoken < SCRIPT.length) {
      const start = this.t
      this.t += 0.4
      this.out({ type: 'Word', text: SCRIPT[this.spoken++], start_time: start })
      this.out({ type: 'EndWord', stop_time: this.t })
    } else if (msg.type === 'Marker') {
      this.out({ type: 'Step', step_idx: this.spoken, prs: eotPrs(0.4) })
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

  private out(msg: OutMsg): void {
    const bytes = encode(msg, { forceFloat32: true })
    queueMicrotask(() => this.messageCb(bytes))
  }
}
