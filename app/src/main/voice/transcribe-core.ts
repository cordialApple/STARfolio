import type { Whisper } from 'smart-whisper'

export interface TranscribeRequest {
  type: 'transcribe'
  id: string
  pcm: number[]
  modelPath: string
}
export interface TranscribeSamplesRequest {
  type: 'transcribeSamples'
  id: string
  samples: Float32Array
  modelPath: string
}
export type WorkerRequest = TranscribeRequest | TranscribeSamplesRequest
export type TranscribeResponse =
  | { id: string; ok: true; text: string }
  | { id: string; ok: false; error: string }

export function int16ToFloat32(pcm: number[]): Float32Array {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-1, Math.min(1, pcm[i] / 32768))
  return out
}

export async function runTranscribe(
  msg: WorkerRequest,
  getWhisper: (modelPath: string) => Whisper
): Promise<TranscribeResponse> {
  try {
    const whisper = getWhisper(msg.modelPath)
    const audio = msg.type === 'transcribe' ? int16ToFloat32(msg.pcm) : msg.samples
    const task = await whisper.transcribe(audio, { language: 'en', n_threads: 4 })
    const segments = await task.result
    const text = segments
      .map((s) => s.text)
      .join(' ')
      .trim()
    return { id: msg.id, ok: true, text }
  } catch (err) {
    return { id: msg.id, ok: false, error: (err as Error).message }
  }
}
