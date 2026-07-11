import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { ensureWhisperModel } from './model'

interface TranscribeResponse {
  id: string
  ok: boolean
  text?: string
  error?: string
}

let child: UtilityProcess | null = null
const pending = new Map<string, { resolve: (t: string) => void; reject: (e: Error) => void }>()

function ensureWorker(): UtilityProcess {
  if (child) return child
  const worker = utilityProcess.fork(join(__dirname, 'voice.worker.js'), [], {
    serviceName: 'starfolio-voice'
  })
  worker.on('message', (msg: TranscribeResponse) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok && typeof msg.text === 'string') p.resolve(msg.text)
    else p.reject(new Error(msg.error ?? 'transcription failed'))
  })
  worker.on('exit', () => {
    child = null
    for (const p of pending.values()) p.reject(new Error('voice worker exited'))
    pending.clear()
  })
  child = worker
  return worker
}

export async function transcribe(pcm: number[], model?: string): Promise<string> {
  const modelName = model ?? process.env.STARFOLIO_WHISPER_MODEL ?? 'base.en'
  const modelPath = await ensureWhisperModel(modelName)
  const worker = ensureWorker()
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.postMessage({ type: 'transcribe', id, pcm, modelPath })
  })
}

export function stopWhisperWorker(): void {
  child?.kill()
  child = null
}
