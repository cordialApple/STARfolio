import { readFileSync } from 'fs'
import { SAMPLE_RATE } from '../src/main/voice/streaming/types'
import { KyutaiSttAdapter } from '../src/main/voice/kyutai/adapter'
import { createTransport } from '../src/main/voice/kyutai/factory'

interface WavPcm {
  samples: Float32Array
  rate: number
}

function readWav(path: string): WavPcm {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }
  let rate = SAMPLE_RATE
  let channels = 1
  let bits = 16
  let off = 12
  let data: Buffer | null = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2)
      rate = buf.readUInt32LE(body + 4)
      bits = buf.readUInt16LE(body + 14)
    } else if (id === 'data') {
      data = buf.subarray(body, body + size)
    }
    off = body + size + (size % 2)
  }
  if (!data) throw new Error('no data chunk')
  if (bits !== 16) throw new Error(`expected PCM16, got ${bits}-bit`)
  const frames = Math.floor(data.length / 2 / channels)
  const samples = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let acc = 0
    for (let c = 0; c < channels; c++) acc += data.readInt16LE((i * channels + c) * 2)
    samples[i] = acc / channels / 32768
  }
  return { samples, rate }
}

async function main(): Promise<void> {
  const path = process.argv[2]
  if (!path) throw new Error('usage: tsx scripts/kyutai-spike.ts <wav> (needs STARFOLIO_KYUTAI_URL or a live server)')
  const { samples, rate } = readWav(path)
  const started = process.hrtime.bigint()
  const ms = (): number => Number(process.hrtime.bigint() - started) / 1e6

  const words: Array<{ text: string; startTime: number; recvMs: number }> = []
  const turns: Array<{ text: string; atMs: number }> = []
  let transcript = ''

  const done = new Promise<void>((resolve, reject) => {
    const adapter = new KyutaiSttAdapter({
      transport: createTransport(),
      inputRate: rate,
      onWord: (w) => words.push({ text: w.text, startTime: w.startTime, recvMs: ms() }),
      onTranscript: (e) => {
        transcript = e.text
        if (e.isFinal) turns.push({ text: e.text, atMs: ms() })
      },
      onEndOfTurn: () => {},
      onError: (m) => reject(new Error(m)),
      onDrained: () => {
        adapter.close()
        resolve()
      }
    })

    const block = Math.round((rate * 80) / 1000)
    let i = 0
    const pump = (): void => {
      if (i >= samples.length) {
        adapter.finish()
        return
      }
      adapter.pushFrames(samples.subarray(i, i + block))
      i += block
      setTimeout(pump, 80)
    }
    pump()
  })

  await done

  const lastWordRecv = words.at(-1)?.recvMs ?? 0
  const firstTurn = turns[0]
  console.log('=== Kyutai STT spike (6c.1 gate) ===')
  console.log(`input: ${path} @ ${rate} Hz, ${(samples.length / rate).toFixed(2)}s`)
  console.log(`\n[1] committed word tokens + timestamps: ${words.length}`)
  for (const w of words) console.log(`  ${w.startTime.toFixed(2)}s  "${w.text}"  (recv +${w.recvMs.toFixed(0)}ms)`)
  console.log(`\n[2] semantic end-of-turn signals: ${turns.length}`)
  for (const t of turns) console.log(`  @${t.atMs.toFixed(0)}ms  "${t.text}"`)
  console.log(`\n[3] endpointing latency:`)
  console.log(`  last committed word recv: +${lastWordRecv.toFixed(0)}ms`)
  console.log(`  first turn finalized:     +${firstTurn ? firstTurn.atMs.toFixed(0) : 'n/a'}ms`)
  console.log(`  EOT after last word:      ${firstTurn ? (firstTurn.atMs - lastWordRecv).toFixed(0) + 'ms' : 'n/a'}`)
  console.log(`\nfinal transcript: "${transcript}"`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
