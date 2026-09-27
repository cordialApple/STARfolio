import { expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ expose: vi.fn(), send: vi.fn(), invoke: vi.fn(), on: vi.fn() }))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: bridge.expose },
  ipcRenderer: {
    send: bridge.send,
    invoke: bridge.invoke,
    on: bridge.on,
    removeListener: vi.fn()
  },
  webUtils: { getPathForFile: vi.fn() }
}))

import './index'

it('sends numeric trial timing through the session-scoped preload route', () => {
  const api = bridge.expose.mock.calls[0][1] as {
    moshiDemo: { timing: (sessionId: string, timing: object) => void }
  }
  const timing = {
    schemaVersion: 1,
    sequence: 1,
    kind: 'mic-ready',
    rendererTimeMs: 100,
    rendererTimeOriginUtcMs: 1_800_000_000_000,
    sampleOffset: null,
    estimatedAtMs: null,
    observedAtMs: 100,
    quantizationMs: null,
    uncertaintyMs: null
  }
  api.moshiDemo.timing('session-1', timing)
  expect(bridge.send).toHaveBeenCalledWith('moshiDemo:timing', {
    sessionId: 'session-1',
    timing
  })
})
