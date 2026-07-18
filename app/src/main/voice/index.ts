import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { ensureWhisperModel } from './model'
import { isWhisperStub } from './whisper-stub'

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

// Deterministic offline transcript for e2e/CI — no model download, no worker. The push-to-talk
// UI flow (record → transcript → edit → send) is what's under test, not whisper's accuracy.
function stubTranscript(sampleCount: number): string {
  const seconds = (sampleCount / 16000).toFixed(1)
  return `This is a stub transcript of a ${seconds} second recording.`
}

async function resolveModelPath(model?: string): Promise<string> {
  const modelName = model ?? process.env.STARFOLIO_WHISPER_MODEL ?? 'base.en'
  return ensureWhisperModel(modelName)
}

function dispatch(
  modelPath: string,
  payload: { type: 'transcribe'; pcm: number[] } | { type: 'transcribeSamples'; samples: Float32Array }
): Promise<string> {
  const worker = ensureWorker()
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.postMessage({ ...payload, id, modelPath })
  })
}

export async function transcribe(pcm: number[], model?: string): Promise<string> {
  if (isWhisperStub()) return stubTranscript(pcm.length)
  return dispatch(await resolveModelPath(model), { type: 'transcribe', pcm })
}

export async function transcribeSamples(samples: Float32Array, model?: string): Promise<string> {
  if (isWhisperStub()) return stubTranscript(samples.length)
  return dispatch(await resolveModelPath(model), { type: 'transcribeSamples', samples })
}

export function stopWhisperWorker(): void {
  child?.kill()
  child = null
}
