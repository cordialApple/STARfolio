import { describe, expect, it } from 'vitest'
import { int16ToFloat32, runTranscribe } from '../../src/main/voice/transcribe-core'
import type { WorkerRequest } from '../../src/main/voice/transcribe-core'

interface Segment {
  text: string
}

function fakeWhisper(segments: Segment[]) {
  const calls: { audio: Float32Array }[] = []
  const whisper = {
    transcribe(audio: Float32Array) {
      calls.push({ audio })
      return Promise.resolve({ result: Promise.resolve(segments) })
    }
  }
  return { whisper, calls }
}

function throwingWhisper(message: string) {
  return () =>
    ({
      transcribe() {
        throw new Error(message)
      }
    }) as never
}

describe('int16ToFloat32', () => {
  it('scales by 1/32768 and clamps to [-1, 1]', () => {
    expect(Array.from(int16ToFloat32([0, 32768, -32768, 65536, -65536]))).toEqual([
      0, 1, -1, 1, -1
    ])
  })
})

describe('runTranscribe', () => {
  const base = { id: 'x1', modelPath: '/m.bin' }

  it('joins segments with a space and trims the result', async () => {
    const { whisper } = fakeWhisper([{ text: '  Hello ' }, { text: 'world  ' }])
    const msg: WorkerRequest = { ...base, type: 'transcribeSamples', samples: new Float32Array([0.1]) }
    const res = await runTranscribe(msg, () => whisper as never)
    expect(res).toEqual({ id: 'x1', ok: true, text: 'Hello  world' })
  })

  it('converts int16 pcm to float32 before decoding', async () => {
    const { whisper, calls } = fakeWhisper([{ text: 'hi' }])
    const msg: WorkerRequest = { ...base, type: 'transcribe', pcm: [32768, 0] }
    await runTranscribe(msg, () => whisper as never)
    expect(Array.from(calls[0].audio)).toEqual([1, 0])
  })

  it('passes Float32 samples through untouched', async () => {
    const { whisper, calls } = fakeWhisper([{ text: 'hi' }])
    const samples = new Float32Array([0.25, -0.5])
    const msg: WorkerRequest = { ...base, type: 'transcribeSamples', samples }
    await runTranscribe(msg, () => whisper as never)
    expect(calls[0].audio).toBe(samples)
  })

  it('maps a thrown error to an ok:false response carrying the message', async () => {
    const msg: WorkerRequest = { ...base, type: 'transcribe', pcm: [0] }
    const res = await runTranscribe(msg, throwingWhisper('model exploded'))
    expect(res).toEqual({ id: 'x1', ok: false, error: 'model exploded' })
  })
})
