import { z } from 'zod'
import { clipboard, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { setSecret, hasSecret, deleteSecret } from './settings/secrets'
import { startChat, cancelStream } from './ai/client'
import { extractStar } from './ai/extract'
import { streamStory, storyConfig } from './ai/story'
import { saveStory, getStory, listStories, storySaveInput } from './db/repositories/stories'
import { searchExperiences } from './search'
import { enqueueEmbed, kickEmbedDrain } from './embed/queue'
import { dbSelfTest } from './db/client'
import { embedSelfTest, getModelStatus } from './embed'
import { transcribe } from './voice'
import {
  experienceInput,
  listFilter,
  createExperience,
  updateExperience,
  deleteExperience,
  getExperience,
  listExperiences,
  listSkills,
  listTags
} from './db/repositories/experiences'

const nonEmpty = z.string().min(1)
const MAX_PROMPT = 100_000
const MAX_PCM_SAMPLES = 16_000 * 300 // 5 minutes at 16 kHz — a generous upper bound
const WHISPER_MODELS = ['tiny.en', 'base.en', 'small.en'] as const

const streamArg = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT),
  requestId: z.string().uuid()
})
const transcribeArg = z.object({
  pcm: z.array(z.number()).min(1).max(MAX_PCM_SAMPLES),
  model: z.enum(WHISPER_MODELS).optional()
})

const idArg = z.object({ id: nonEmpty.max(64) })
const updateArg = z.object({ id: nonEmpty.max(64), input: experienceInput })
const extractArg = z.object({ text: z.string().min(1).max(200_000) })
const copyArg = z.object({ text: z.string().max(50_000) })

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
  ipcMain.handle('embed:selfTest', () => embedSelfTest())
  ipcMain.handle('embed:modelStatus', () => getModelStatus())
  handle(ipcMain, 'voice:transcribe', transcribeArg, (_e, { pcm, model }) => transcribe(pcm, model))

  ipcMain.handle('ai:hasKey', () => hasSecret('anthropic_api_key'))
  ipcMain.handle('ai:deleteKey', () => deleteSecret('anthropic_api_key'))
  handle(ipcMain, 'ai:setKey', nonEmpty, (_e, key) => setSecret('anthropic_api_key', key))
  handle(ipcMain, 'ai:stream', streamArg, (event, { prompt, requestId }) =>
    startChat(prompt, requestId, event.sender)
  )
  handle(ipcMain, 'ai:cancel', nonEmpty, (_e, requestId) => cancelStream(requestId))

  handle(ipcMain, 'brain:extract', extractArg, (_e, { text }) => extractStar(text))

  handle(ipcMain, 'story:generate', storyConfig, (event, config) =>
    streamStory(config, event.sender)
  )
  handle(ipcMain, 'story:cancel', nonEmpty, (_e, requestId) => cancelStream(requestId))
  handle(ipcMain, 'story:save', storySaveInput, (_e, input) => saveStory(input))
  handle(ipcMain, 'story:get', idArg, (_e, { id }) => getStory(id))
  ipcMain.handle('story:list', () => listStories())

  handle(ipcMain, 'clipboard:write', copyArg, (_e, { text }) => clipboard.writeText(text))

  handle(ipcMain, 'bank:create', experienceInput, (_e, input) => {
    const exp = createExperience(input)
    enqueueEmbed(exp.id)
    kickEmbedDrain()
    return exp
  })
  handle(ipcMain, 'bank:update', updateArg, (_e, { id, input }) => {
    const exp = updateExperience(id, input)
    enqueueEmbed(exp.id)
    kickEmbedDrain()
    return exp
  })
  handle(ipcMain, 'bank:delete', idArg, (_e, { id }) => deleteExperience(id))
  handle(ipcMain, 'bank:get', idArg, (_e, { id }) => getExperience(id))
  handle(ipcMain, 'bank:list', listFilter, (_e, filter) => listExperiences(filter))
  handle(ipcMain, 'bank:search', listFilter, (_e, filter) => searchExperiences(filter))
  ipcMain.handle('bank:skills', () => listSkills())
  ipcMain.handle('bank:tags', () => listTags())
}
