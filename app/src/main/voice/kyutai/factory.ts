import { isKyutaiStub } from './config'
import { StubTransport } from './stub'
import type { SttTransport } from './transport'
import { WebSocketTransport } from './ws-transport'

export function createTransport(): SttTransport {
  return isKyutaiStub() ? new StubTransport() : new WebSocketTransport()
}
