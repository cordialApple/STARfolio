import { readFileSync } from 'fs'
import { performance } from 'perf_hooks'

const SAMPLE_RATE = 16000
const DECODE_INTERVAL = SAMPLE_RATE
const MAX_WINDOW = SAMPLE_RATE * 30

function usage() {
  console.error(
    [
      'Streaming RTF harness — proves sustained real-time factor < 1.0 on target hardware (Stage 6b.1).',
      '',
      'Usage: node scripts/bench-streaming-rtf.mjs <audio.wav> [modelPath]',
      '',
      '  <audio.wav>  16 kHz mono 16-bit PCM WAV (a real interview answer, 30-60s)',
      '  [modelPath]  ggml-*.bin whisper model (defaults to ggml-base.en.bin next to the wav)',
      '',
      'Re-decodes a growing window every ~1s (capped at 30s) and reports mean/worst RTF per decode.',
      'This is a MANUAL run: real RTF and echo numbers need a mic + packaged build, not CI.'
    ].join('\n')
  )
}

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }
  let offset = 12
  let fmt = null
  let dataOffset = -1
  let dataLen = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bits: buf.readUInt16LE(offset + 22)
      }
    } else if (id === 'data') {
      dataOffset = offset + 8
      dataLen = size
    }
    offset += 8 + size + (size % 2)
  }
  if (!fmt || dataOffset < 0) throw new Error('missing fmt or data chunk')
  if (fmt.channels !== 1 || fmt.sampleRate !== SAMPLE_RATE || fmt.bits !== 16) {
    throw new Error(`need 16 kHz mono 16-bit PCM, got ${fmt.sampleRate} Hz ${fmt.channels}ch ${fmt.bits}bit`)
  }
  const count = Math.floor(dataLen / 2)
  const pcm = new Float32Array(count)
  for (let i = 0; i < count; i++) pcm[i] = buf.readInt16LE(dataOffset + i * 2) / 32768
  return pcm
}

async function main() {
  const [, , wavPath, modelArg] = process.argv
  if (!wavPath) {
    usage()
    process.exit(1)
  }
  const pcm = parseWav(readFileSync(wavPath))
  const modelPath = modelArg ?? new URL('ggml-base.en.bin', `file://${wavPath}`).pathname
  const { Whisper } = await import('smart-whisper')
  const whisper = new Whisper(modelPath, { gpu: false })

  let audioMs = 0
  let decodeMs = 0
  let worst = 0
  for (let end = DECODE_INTERVAL; end <= pcm.length; end += DECODE_INTERVAL) {
    const start = Math.max(0, end - MAX_WINDOW)
    const window = pcm.subarray(start, end)
    const windowMs = (window.length / SAMPLE_RATE) * 1000
    const t0 = performance.now()
    const task = await whisper.transcribe(window, { language: 'en', n_threads: 4 })
    await task.result
    const elapsed = performance.now() - t0
    audioMs += windowMs
    decodeMs += elapsed
    const rtf = elapsed / windowMs
    if (rtf > worst) worst = rtf
    console.log(`window ${(windowMs / 1000).toFixed(0)}s  decode ${elapsed.toFixed(0)}ms  rtf ${rtf.toFixed(3)}`)
  }
  await whisper.free()

  const mean = audioMs === 0 ? 0 : decodeMs / audioMs
  console.log('---')
  console.log(`mean rtf ${mean.toFixed(3)}  worst rtf ${worst.toFixed(3)}  ${worst < 1 ? 'PASS (< 1.0)' : 'FAIL (>= 1.0)'}`)
  process.exit(worst < 1 ? 0 : 2)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
