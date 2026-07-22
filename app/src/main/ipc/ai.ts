import { z } from 'zod'
import type { IpcMain } from 'electron'
import { handle, nonEmpty } from './shared'
import { setSecret, hasSecret, deleteSecret } from '../settings/secrets'
import { startChat, cancelStream } from '../ai/client'
import { extractStar, extractResumeStar } from '../ai/extract'
import { PROVIDERS, type Provider } from '../ai/routing'

const MAX_PROMPT = 100_000
const streamArg = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT),
  requestId: z.string().uuid()
})
const extractArg = z.object({ text: z.string().min(1).max(200_000) })

const SECRET_KEYS: Record<Provider, string> = {
  anthropic: 'anthropic_api_key',
  openai: 'openai_api_key',
  gemini: 'gemini_api_key'
}
const provider = z.enum(PROVIDERS)
const providerArg = z.object({ provider })
const providerKeyArg = z.object({ provider, key: nonEmpty })

export function registerAi(ipcMain: IpcMain): void {
  ipcMain.handle('ai:hasKey', () => hasSecret(SECRET_KEYS.anthropic))
  ipcMain.handle('ai:deleteKey', () => deleteSecret(SECRET_KEYS.anthropic))
  handle(ipcMain, 'ai:setKey', nonEmpty, (_e, key) => setSecret(SECRET_KEYS.anthropic, key))
  handle(ipcMain, 'ai:provider:hasKey', providerArg, (_e, { provider: p }) =>
    hasSecret(SECRET_KEYS[p])
  )
  handle(ipcMain, 'ai:provider:deleteKey', providerArg, (_e, { provider: p }) =>
    deleteSecret(SECRET_KEYS[p])
  )
  handle(ipcMain, 'ai:provider:setKey', providerKeyArg, (_e, { provider: p, key }) =>
    setSecret(SECRET_KEYS[p], key)
  )
  handle(ipcMain, 'ai:stream', streamArg, (event, { prompt, requestId }) =>
    startChat(prompt, requestId, event.sender)
  )
  handle(ipcMain, 'ai:cancel', nonEmpty, (_e, requestId) => cancelStream(requestId))

  handle(ipcMain, 'brain:extract', extractArg, (_e, { text }) => extractStar(text))
  handle(ipcMain, 'resume:extract', extractArg, (_e, { text }) => extractResumeStar(text))
}
