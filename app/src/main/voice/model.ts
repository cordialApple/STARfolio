import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, createWriteStream, renameSync, rmSync } from 'fs'
import { isWhisperStub } from './whisper-stub'

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

function statusOf(name: string): ModelStatus {
  return statuses.get(name) ?? { phase: 'idle', progress: 0, error: null }
}

function modelDir(): string {
  const dir = join(app.getPath('userData'), 'models', 'whisper')
  mkdirSync(dir, { recursive: true })
  return dir
}
function modelPath(name: string): string {
  return join(modelDir(), `ggml-${name}.bin`)
}

function setStatus(name: string, s: ModelStatus): void {
  statuses.set(name, s)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('voice:modelStatus', whisperModels())
  }
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
  const tmp = `${dest}.download`
  setStatus(name, { phase: 'downloading', progress: 0, error: null })
  const res = await fetch(MODELS[name].url)
  if (!res.ok || !res.body) throw new Error(`whisper model download failed: ${res.status}`)
  const total = Number(res.headers.get('content-length')) || MODELS[name].sizeMB * 1024 * 1024
  const file = createWriteStream(tmp)
  let loaded = 0
  let lastPct = -1
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      loaded += value.length
      if (!file.write(value)) await new Promise<void>((r) => file.once('drain', () => r()))
      const pct = Math.min(99, Math.round((loaded / total) * 100))
      if (pct !== lastPct) {
        lastPct = pct
        setStatus(name, { phase: 'downloading', progress: pct, error: null })
      }
    }
    await new Promise<void>((resolve, reject) => file.end(() => resolve()).on('error', reject))
    renameSync(tmp, dest)
    setStatus(name, { phase: 'ready', progress: 100, error: null })
  } catch (err) {
    // Wait for the fd to actually close before unlinking — on Windows rmSync can EBUSY against a
    // still-closing handle.
    await new Promise<void>((resolve) => {
      if (file.destroyed) return resolve()
      file.once('close', () => resolve())
      file.destroy()
    })
    rmSync(tmp, { force: true })
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
