// Push-to-talk mic capture: getUserMedia + AudioWorklet at a 16 kHz mono AudioContext
// (Chromium resamples the mic to 16 kHz for us), collecting Float32 frames and converting
// to Int16 PCM on stop — the format whisper.cpp expects.

export interface Recording {
  stop: () => Promise<Int16Array>
}

export interface RecordOptions {
  onLevel?: (level: number) => void
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
    const chunks: Float32Array[] = []
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      chunks.push(e.data)
      opts.onLevel?.(rms(e.data))
    }
    source.connect(node)
    const audioCtx = ctx

    return {
      async stop(): Promise<Int16Array> {
        source.disconnect()
        node.disconnect()
        stream.getTracks().forEach((t) => t.stop())
        await audioCtx.close()
        return floatChunksToInt16(chunks)
      }
    }
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop())
    await ctx?.close()
    throw err
  }
}
