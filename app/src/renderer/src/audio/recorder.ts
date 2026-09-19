export interface Recording<T = Int16Array> {
  stop: () => Promise<T>
}

interface RecordOptions {
  sampleRate?: number
  onLevel?: (level: number) => void
}

export interface BufferedRecordOptions extends RecordOptions {
  onFrames?: never
  batchSamples?: never
}

export interface StreamingRecordOptions extends RecordOptions {
  onFrames: (frames: Float32Array) => void
  batchSamples?: number
}

export interface FrameSink<T> {
  push: (frame: Float32Array) => void
  finish: () => T
}

type ProcessorMessage = { type: 'frames'; frames: Float32Array } | { type: 'drained' }

const DEFAULT_BATCH_SAMPLES = 4000
const DRAIN_TIMEOUT_MS = 250

function concatFloat32(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function rms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / (frame.length || 1))
}

function floatChunksToInt16(chunks: Float32Array[]): Int16Array {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Int16Array(total)
  let offset = 0
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]))
      out[offset++] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
  }
  return out
}

function createLevelReporter(onLevel?: (level: number) => void): (frame: Float32Array) => void {
  if (!onLevel) return () => {}

  let frameCount = 0
  return (frame) => {
    if (frameCount++ % 4 === 0) onLevel(rms(frame))
  }
}

export function createBufferedFrameSink(
  opts: Pick<BufferedRecordOptions, 'onLevel'> = {}
): FrameSink<Int16Array> {
  const chunks: Float32Array[] = []
  const reportLevel = createLevelReporter(opts.onLevel)

  return {
    push(frame): void {
      chunks.push(frame)
      reportLevel(frame)
    },
    finish(): Int16Array {
      return floatChunksToInt16(chunks)
    }
  }
}

export function createStreamingFrameSink(
  opts: Pick<StreamingRecordOptions, 'onFrames' | 'batchSamples' | 'onLevel'>
): FrameSink<void> {
  const batchSamples = opts.batchSamples ?? DEFAULT_BATCH_SAMPLES
  if (!Number.isInteger(batchSamples) || batchSamples <= 0) {
    throw new RangeError('batchSamples must be a positive integer')
  }
  const reportLevel = createLevelReporter(opts.onLevel)
  let pendingFrames: Float32Array[] = []
  let pendingSampleCount = 0

  function flushBatch(): void {
    if (pendingSampleCount === 0) return
    const frames = concatFloat32(pendingFrames, pendingSampleCount)
    pendingFrames = []
    pendingSampleCount = 0
    opts.onFrames(frames)
  }

  return {
    push(frame): void {
      reportLevel(frame)
      pendingFrames.push(frame)
      pendingSampleCount += frame.length
      if (pendingSampleCount >= batchSamples) flushBatch()
    },
    finish(): void {
      flushBatch()
    }
  }
}

function stopTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop())
}

async function waitForDrain(drained: Promise<void>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      drained,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Audio worklet drain timed out')),
          DRAIN_TIMEOUT_MS
        )
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function startRecording(opts: StreamingRecordOptions): Promise<Recording<void>>
export function startRecording(opts?: BufferedRecordOptions): Promise<Recording<Int16Array>>
export async function startRecording(
  opts: BufferedRecordOptions | StreamingRecordOptions = {}
): Promise<Recording<Int16Array | void>> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  })
  let audioContext: AudioContext | undefined
  try {
    audioContext = new AudioContext({ sampleRate: opts.sampleRate ?? 16000 })
    await audioContext.audioWorklet.addModule(new URL('./pcm-processor.js', import.meta.url))

    const source = audioContext.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(audioContext, 'pcm-processor')
    const sink = opts.onFrames
      ? createStreamingFrameSink(opts)
      : createBufferedFrameSink({ onLevel: opts.onLevel })
    let resolveDrain: () => void
    const drained = new Promise<void>((resolve) => {
      resolveDrain = resolve
    })
    node.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
      if (event.data.type === 'frames') sink.push(event.data.frames)
      else if (event.data.type === 'drained') resolveDrain()
    }
    source.connect(node)
    const openContext = audioContext

    let stopPromise: Promise<Int16Array | void> | undefined
    return {
      stop(): Promise<Int16Array | void> {
        if (stopPromise) return stopPromise
        stopPromise = (async () => {
          let cleanupError: unknown
          const retainCleanupError = (error: unknown): void => {
            cleanupError ??= error
          }
          const attemptCleanup = (cleanup: () => void): void => {
            try {
              cleanup()
            } catch (error) {
              retainCleanupError(error)
            }
          }
          attemptCleanup(() => source.disconnect())
          attemptCleanup(() => stopTracks(stream))
          try {
            node.port.postMessage({ type: 'stop' })
            await waitForDrain(drained)
          } catch (error) {
            retainCleanupError(error)
          }
          node.port.onmessage = null
          attemptCleanup(() => node.disconnect())
          try {
            await openContext.close()
          } catch (error) {
            retainCleanupError(error)
          }
          const result = sink.finish()
          if (cleanupError) throw cleanupError
          return result
        })()
        return stopPromise
      }
    }
  } catch (err) {
    await Promise.allSettled([
      Promise.resolve().then(() => stopTracks(stream)),
      Promise.resolve().then(() => audioContext?.close())
    ])
    throw err
  }
}
