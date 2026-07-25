export interface CloseInfo {
  code?: number
  reason?: string
}

export interface SttTransport {
  send(bytes: Uint8Array): void
  onMessage(cb: (bytes: Uint8Array) => void): void
  onOpen(cb: () => void): void
  onClose(cb: (info: CloseInfo) => void): void
  onError(cb: (err: Error) => void): void
  close(): void
}

export class FakeTransport implements SttTransport {
  readonly sent: Uint8Array[] = []
  private messageCb: (bytes: Uint8Array) => void = () => {}
  private openCb: () => void = () => {}
  private closeCb: (info: CloseInfo) => void = () => {}
  private errorCb: (err: Error) => void = () => {}
  closed = false

  send(bytes: Uint8Array): void {
    this.sent.push(bytes)
  }
  onMessage(cb: (bytes: Uint8Array) => void): void {
    this.messageCb = cb
  }
  onOpen(cb: () => void): void {
    this.openCb = cb
  }
  onClose(cb: (info: CloseInfo) => void): void {
    this.closeCb = cb
  }
  onError(cb: (err: Error) => void): void {
    this.errorCb = cb
  }
  close(): void {
    this.closed = true
    this.closeCb({})
  }

  fireOpen(): void {
    this.openCb()
  }
  deliver(bytes: Uint8Array): void {
    this.messageCb(bytes)
  }
  fireError(err: Error): void {
    this.errorCb(err)
  }
}
