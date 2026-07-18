import { Whisper } from 'smart-whisper'
import { runTranscribe, type TranscribeResponse, type WorkerRequest } from './transcribe-core'

interface ParentPort {
  on(event: 'message', listener: (e: { data: WorkerRequest }) => void): void
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

parentPort.on('message', (e) => {
  const msg = e.data
  if (msg.type !== 'transcribe' && msg.type !== 'transcribeSamples') return
  void runTranscribe(msg, getWhisper).then((res) => parentPort.postMessage(res))
})
