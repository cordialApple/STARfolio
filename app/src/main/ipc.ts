import { type IpcMain } from 'electron'
import { type IpcHooks } from './ipc/shared'
import { registerSystem } from './ipc/system'
import { registerVoice } from './ipc/voice'
import { registerAi } from './ipc/ai'
import { registerIngest } from './ipc/ingest'
import { registerContent } from './ipc/content'
import { registerSessions } from './ipc/sessions'
import { registerCorpus } from './ipc/corpus'
import { registerBank } from './ipc/bank'

export type { IpcHooks }

export function registerIpcHandlers(ipcMain: IpcMain, hooks: IpcHooks = {}): void {
  registerSystem(ipcMain, hooks)
  registerVoice(ipcMain)
  registerAi(ipcMain)
  registerIngest(ipcMain)
  registerContent(ipcMain)
  registerSessions(ipcMain)
  registerCorpus(ipcMain)
  registerBank(ipcMain)
}
