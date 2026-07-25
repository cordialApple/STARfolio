import type { SttTransport } from '../transport'
import { WebSocketTransport } from '../ws-transport'
import { isKyutaiTtsStub, kyutaiTtsApiKey, kyutaiTtsEndpoint } from './config'
import { StubTtsTransport } from './stub'

export function createTtsTransport(): SttTransport {
  return isKyutaiTtsStub()
    ? new StubTtsTransport()
    : new WebSocketTransport(kyutaiTtsEndpoint(), kyutaiTtsApiKey())
}
