// Push-to-talk mic capture: getUserMedia + AudioWorklet at a 16 kHz mono AudioContext
// (Chromium resamples the mic to 16 kHz for us), collecting Float32 frames and converting
// to Int16 PCM on stop — the format whisper.cpp expects.

export interface Recording {
  stop: () => Promise<Int16Array>
}

export interface RecordOptions {
  onLevel?: (level: number) => void
  onFrames?: (frames: Float32Array) => void
  batchSamples?: number
}

const DEFAULT_BATCH_SAMPLES = 4000

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

export async function startRecording(opts: RecordOptions = {}): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  })
  let audioContext: AudioContext | undefined
  try {
    audioContext = new AudioContext({ sampleRate: 16000 })
    await audioContext.audioWorklet.addModule(new URL('./pcm-processor.js', import.meta.url))

    const source = audioContext.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(audioContext, 'pcm-processor')
    const chunks: Float32Array[] = []
    const batchSamples = opts.batchSamples ?? DEFAULT_BATCH_SAMPLES
    let batch: Float32Array[] = []
    let batchLen = 0
    // Worklet posts ~125 frames/sec; meter every 4th (~30 Hz) to avoid a React state update per frame.
    let frame = 0
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      chunks.push(e.data)
      if (opts.onLevel && frame++ % 4 === 0) opts.onLevel(rms(e.data))
      if (opts.onFrames) {
        batch.push(e.data)
        batchLen += e.data.length
        if (batchLen >= batchSamples) {
          opts.onFrames(concatFloat32(batch, batchLen))
          batch = []
          batchLen = 0
        }
      }
    }
    source.connect(node)
    const openContext = audioContext

    return {
      async stop(): Promise<Int16Array> {
        source.disconnect()
        node.disconnect()
        stream.getTracks().forEach((t) => t.stop())
        await openContext.close()
        if (opts.onFrames && batchLen > 0) opts.onFrames(concatFloat32(batch, batchLen))
        return floatChunksToInt16(chunks)
      }
    }
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop())
    await audioContext?.close()
    throw err
  }
}
