import WebSocket from 'ws'
import type { CloseInfo, SttTransport } from './transport'
import { kyutaiApiKey, kyutaiEndpoint } from './config'

export class WebSocketTransport implements SttTransport {
  private readonly ws: WebSocket

  constructor(url = kyutaiEndpoint(), apiKey = kyutaiApiKey()) {
    this.ws = new WebSocket(url, { headers: { 'kyutai-api-key': apiKey } })
    this.ws.binaryType = 'nodebuffer'
  }

  send(bytes: Uint8Array): void {
    this.ws.send(bytes)
  }
  onMessage(cb: (bytes: Uint8Array) => void): void {
    this.ws.on('message', (data: WebSocket.RawData) => cb(toBytes(data)))
  }
  onOpen(cb: () => void): void {
    this.ws.on('open', cb)
  }
  onClose(cb: (info: CloseInfo) => void): void {
    this.ws.on('close', (code, reason) => cb({ code, reason: reason.toString() }))
  }
  onError(cb: (err: Error) => void): void {
    this.ws.on('error', cb)
  }
  close(): void {
    this.ws.close()
  }
}

function toBytes(data: WebSocket.RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  return new Uint8Array(data)
}
