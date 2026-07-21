import { z } from 'zod'
import type { IpcMain } from 'electron'
import { handle } from './shared'
import { transcribe } from '../voice'
import { registerVoiceStream } from '../voice/stream'
import { whisperModels, ensureWhisperModel, deleteWhisperModel, WHISPER_MODELS } from '../voice/model'

const MAX_PCM_SAMPLES = 16_000 * 300 // 5 minutes at 16 kHz — a generous upper bound
const transcribeArg = z.object({
  pcm: z.array(z.number()).min(1).max(MAX_PCM_SAMPLES),
  model: z.enum(WHISPER_MODELS).optional()
})
const voiceModelArg = z.object({ model: z.enum(WHISPER_MODELS) })

export function registerVoice(ipcMain: IpcMain): void {
  handle(ipcMain, 'voice:transcribe', transcribeArg, (_e, { pcm, model }) => transcribe(pcm, model))
  ipcMain.handle('voice:models', () => whisperModels())
  handle(ipcMain, 'voice:downloadModel', voiceModelArg, (_e, { model }) =>
    ensureWhisperModel(model).then(() => whisperModels())
  )
  handle(ipcMain, 'voice:deleteModel', voiceModelArg, (_e, { model }) => {
    deleteWhisperModel(model)
    return whisperModels()
  })
  registerVoiceStream(ipcMain)
}
