import { join } from 'path'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { isWhisperStub } from './whisper-stub'
import { downloadToFile } from './download'

export type ModelPhase = 'idle' | 'downloading' | 'ready' | 'error'
export interface ModelStatus {
  phase: ModelPhase
  progress: number
  error: string | null
}
export interface WhisperModelInfo {
  name: string
  sizeMB: number
  downloaded: boolean
  status: ModelStatus
}

// Single source of truth for the installable model set — the IPC-boundary zod enum imports this
// so the accept-list can never drift from the manager's actual models.
export const WHISPER_MODELS = ['tiny.en', 'base.en', 'small.en'] as const
export type WhisperModel = (typeof WHISPER_MODELS)[number]

interface ModelDef {
  url: string
  sizeMB: number
}
const MODELS: Record<WhisperModel, ModelDef> = {
  'tiny.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    sizeMB: 75
  },
  'base.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    sizeMB: 142
  },
  'small.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    sizeMB: 466
  }
}

const statuses = new Map<string, ModelStatus>()

let broadcast: (models: WhisperModelInfo[]) => void = () => {}
let userDataDir: () => string = () => {
  throw new Error('whisper model manager not configured')
}

export function configureWhisperModels(deps: {
  broadcast: (models: WhisperModelInfo[]) => void
  userDataDir: () => string
}): void {
  broadcast = deps.broadcast
  userDataDir = deps.userDataDir
}

function statusOf(name: string): ModelStatus {
  return statuses.get(name) ?? { phase: 'idle', progress: 0, error: null }
}

function modelDir(): string {
  const dir = join(userDataDir(), 'models', 'whisper')
  mkdirSync(dir, { recursive: true })
  return dir
}
function modelPath(name: string): string {
  return join(modelDir(), `ggml-${name}.bin`)
}

function setStatus(name: string, s: ModelStatus): void {
  statuses.set(name, s)
  broadcast(whisperModels())
}

export function whisperModels(): WhisperModelInfo[] {
  const stub = isWhisperStub()
  return WHISPER_MODELS.map((name) => {
    const downloaded = stub ? name === 'base.en' : existsSync(modelPath(name))
    const base = statusOf(name)
    return {
      name,
      sizeMB: MODELS[name].sizeMB,
      downloaded,
      status: downloaded && base.phase === 'idle' ? { phase: 'ready', progress: 100, error: null } : base
    }
  })
}

export function deleteWhisperModel(name: string): void {
  if (!MODELS[name]) throw new Error(`unknown whisper model: ${name}`)
  rmSync(modelPath(name), { force: true })
  setStatus(name, { phase: 'idle', progress: 0, error: null })
}

async function download(name: string, dest: string): Promise<void> {
  setStatus(name, { phase: 'downloading', progress: 0, error: null })
  try {
    await downloadToFile(
      MODELS[name].url,
      dest,
      (pct) => setStatus(name, { phase: 'downloading', progress: pct, error: null }),
      MODELS[name].sizeMB * 1024 * 1024
    )
    setStatus(name, { phase: 'ready', progress: 100, error: null })
  } catch (err) {
    setStatus(name, { phase: 'error', progress: 0, error: (err as Error).message })
    throw err
  }
}

// transformers.js/whisper.cpp have no resumable download, so a killed download restarts;
// the on-disk model is only renamed into place once fully written, so a partial never loads.
export async function ensureWhisperModel(name: string): Promise<string> {
  if (!MODELS[name]) throw new Error(`unknown whisper model: ${name}`)
  const dest = modelPath(name)
  if (existsSync(dest)) {
    if (statusOf(name).phase !== 'ready') setStatus(name, { phase: 'ready', progress: 100, error: null })
    return dest
  }
  await download(name, dest)
  return dest
}
