import { Whisper } from 'smart-whisper'

interface TranscribeRequest {
  type: 'transcribe'
  id: string
  pcm: number[]
  modelPath: string
}
type TranscribeResponse =
  | { id: string; ok: true; text: string }
  | { id: string; ok: false; error: string }

interface ParentPort {
  on(event: 'message', listener: (e: { data: TranscribeRequest }) => void): void
  postMessage(message: TranscribeResponse): void
}

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort

const instances = new Map<string, Whisper>()
function getWhisper(modelPath: string): Whisper {
  let whisper = instances.get(modelPath)
  if (!whisper) {
    whisper = new Whisper(modelPath, { gpu: false })
    instances.set(modelPath, whisper)
  }
  return whisper
}

function int16ToFloat32(pcm: number[]): Float32Array {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-1, Math.min(1, pcm[i] / 32768))
  return out
}

parentPort.on('message', (e) => {
  const msg = e.data
  if (msg.type !== 'transcribe') return
  void (async () => {
    try {
      const whisper = getWhisper(msg.modelPath)
      const task = await whisper.transcribe(int16ToFloat32(msg.pcm), {
        language: 'en',
        n_threads: 4
      })
      const segments = await task.result
      const text = segments
        .map((s) => s.text)
        .join(' ')
        .trim()
      parentPort.postMessage({ id: msg.id, ok: true, text })
    } catch (err) {
      parentPort.postMessage({ id: msg.id, ok: false, error: (err as Error).message })
    }
  })()
})
