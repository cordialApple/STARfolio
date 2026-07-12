// Unit tests run in a plain Node env; resolving the real `electron` package there pulls in the
// electron binary and its dist extraction, which races across vitest workers on CI (os error 183).
// Aliasing `electron` to these inert stubs keeps unit tests off the binary entirely.

export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer): string => b.toString('utf8')
}

export const app = {
  getPath: (): string => '',
  getName: (): string => 'starfolio-test'
}

export const BrowserWindow = {
  getAllWindows: (): unknown[] => []
}

export const clipboard = {
  writeText: (): void => {},
  readText: (): string => ''
}

export const ipcMain = {
  handle: (): void => {},
  on: (): void => {}
}

// Throw rather than return a dead worker: worker-backed paths (embed, voice) must fail fast in
// unit tests so their callers hit the "model unavailable" fallback instead of hanging forever.
export const utilityProcess = {
  fork: (): never => {
    throw new Error('utilityProcess is not available in unit tests')
  }
}

export default { safeStorage, app, BrowserWindow, clipboard, ipcMain, utilityProcess }
