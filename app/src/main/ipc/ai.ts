import { z } from 'zod'
import type { IpcMain } from 'electron'
import { handle, nonEmpty } from './shared'
import { setSecret, hasSecret, deleteSecret } from '../settings/secrets'
import { startChat, cancelStream } from '../ai/client'
import { extractStar, extractResumeStar } from '../ai/extract'

const MAX_PROMPT = 100_000
const streamArg = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT),
  requestId: z.string().uuid()
})
const extractArg = z.object({ text: z.string().min(1).max(200_000) })

export function registerAi(ipcMain: IpcMain): void {
  ipcMain.handle('ai:hasKey', () => hasSecret('anthropic_api_key'))
  ipcMain.handle('ai:deleteKey', () => deleteSecret('anthropic_api_key'))
  handle(ipcMain, 'ai:setKey', nonEmpty, (_e, key) => setSecret('anthropic_api_key', key))
  handle(ipcMain, 'ai:stream', streamArg, (event, { prompt, requestId }) =>
    startChat(prompt, requestId, event.sender)
  )
  handle(ipcMain, 'ai:cancel', nonEmpty, (_e, requestId) => cancelStream(requestId))

  handle(ipcMain, 'brain:extract', extractArg, (_e, { text }) => extractStar(text))
  handle(ipcMain, 'resume:extract', extractArg, (_e, { text }) => extractResumeStar(text))
}
