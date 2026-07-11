import { z } from 'zod'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { setSecret, hasSecret, deleteSecret } from './settings/secrets'
import { startStream, cancelStream } from './ai/client'
import { dbSelfTest } from './db/client'

const nonEmpty = z.string().min(1)
const streamArg = z.object({ prompt: z.string().min(1), requestId: z.string().uuid() })

function handle<S extends z.ZodTypeAny, R>(
  ipcMain: IpcMain,
  channel: string,
  schema: S,
  fn: (event: IpcMainInvokeEvent, arg: z.infer<S>) => R
): void {
  ipcMain.handle(channel, (event, raw) => fn(event, schema.parse(raw)))
}

export function registerIpcHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('ping', () => 'pong')
  ipcMain.handle('db:selfTest', () => dbSelfTest())

  ipcMain.handle('ai:hasKey', () => hasSecret('anthropic_api_key'))
  ipcMain.handle('ai:deleteKey', () => deleteSecret('anthropic_api_key'))
  handle(ipcMain, 'ai:setKey', nonEmpty, (_e, key) => setSecret('anthropic_api_key', key))
  handle(ipcMain, 'ai:stream', streamArg, (event, { prompt, requestId }) =>
    startStream(prompt, requestId, event.sender)
  )
  handle(ipcMain, 'ai:cancel', nonEmpty, (_e, requestId) => cancelStream(requestId))
}
