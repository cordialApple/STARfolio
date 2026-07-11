import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

interface EmbedRequest {
  type: 'embed'
  id: string
  text: string
  cacheDir: string
}
type EmbedResponse =
  | { id: string; ok: true; vector: number[] }
  | { id: string; ok: false; error: string }

interface ParentPort {
  on(event: 'message', listener: (e: { data: EmbedRequest }) => void): void
  postMessage(message: EmbedResponse): void
}

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort

const MODEL = 'Xenova/bge-small-en-v1.5'
let pipePromise: Promise<FeatureExtractionPipeline> | null = null

function getPipe(cacheDir: string): Promise<FeatureExtractionPipeline> {
  if (!pipePromise) {
    env.cacheDir = cacheDir
    env.allowRemoteModels = true
    pipePromise = pipeline('feature-extraction', MODEL, { dtype: 'q8' })
  }
  return pipePromise
}

parentPort.on('message', (e) => {
  const msg = e.data
  if (msg.type !== 'embed') return
  void (async () => {
    try {
      const pipe = await getPipe(msg.cacheDir)
      const out = await pipe(msg.text, { pooling: 'mean', normalize: true })
      parentPort.postMessage({ id: msg.id, ok: true, vector: Array.from(out.data as Float32Array) })
    } catch (err) {
      parentPort.postMessage({ id: msg.id, ok: false, error: (err as Error).message })
    }
  })()
})
