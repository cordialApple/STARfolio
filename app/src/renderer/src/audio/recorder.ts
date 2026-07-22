// AudioContext({ sampleRate: 16000 }) leans on Chromium resampling the mic to 16 kHz for us —
// the rate whisper.cpp expects — so frames arrive ready to pack into Int16 PCM.

export interface Recording {
  stop: () => Promise<Int16Array>
}

export interface RecordOptions {
  onLevel?: (level: number) => void
  onFrames?: (frames: Float32Array) => void
  batchSamples?: number
}

export interface FrameSink {
  push: (frame: Float32Array) => void
  finish: () => Int16Array
}

const DEFAULT_BATCH_SAMPLES = 4000
const EMPTY_PCM = new Int16Array(0)

function concatFloat32(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
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
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]))
      out[offset++] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
  }
  return out
}

export function createFrameSink(opts: RecordOptions = {}): FrameSink {
  const batchSamples = opts.batchSamples ?? DEFAULT_BATCH_SAMPLES
  const chunks: Float32Array[] = []
  let batch: Float32Array[] = []
  let batchLen = 0
  // Worklet posts ~125 frames/sec; meter every 4th (~30 Hz) to avoid a React state update per frame.
  let frame = 0
  return {
    push(f: Float32Array): void {
      // Streaming consumers drain frames via onFrames and discard stop()'s buffer, so skip the
      // unbounded full-session accumulation that only push-to-talk (no onFrames) actually reads.
      if (!opts.onFrames) chunks.push(f)
      if (opts.onLevel && frame++ % 4 === 0) opts.onLevel(rms(f))
      if (opts.onFrames) {
        batch.push(f)
        batchLen += f.length
        if (batchLen >= batchSamples) {
          opts.onFrames(concatFloat32(batch, batchLen))
          batch = []
          batchLen = 0
        }
      }
    },
    finish(): Int16Array {
      if (opts.onFrames && batchLen > 0) opts.onFrames(concatFloat32(batch, batchLen))
      return opts.onFrames ? EMPTY_PCM : floatChunksToInt16(chunks)
    }
  }
}

export async function startRecording(opts: RecordOptions = {}): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  })
  let ctx: AudioContext | undefined
  try {
    ctx = new AudioContext({ sampleRate: 16000 })
    await ctx.audioWorklet.addModule(new URL('./pcm-processor.js', import.meta.url))

    const source = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'pcm-processor')
    const sink = createFrameSink(opts)
    node.port.onmessage = (e: MessageEvent<Float32Array>) => sink.push(e.data)
    source.connect(node)
    const audioCtx = ctx

    return {
      async stop(): Promise<Int16Array> {
        source.disconnect()
        node.disconnect()
        stream.getTracks().forEach((t) => t.stop())
        await audioCtx.close()
        return sink.finish()
      }
    }
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop())
    await ctx?.close()
    throw err
  }
}
