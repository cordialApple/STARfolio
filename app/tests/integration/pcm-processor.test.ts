import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startRecording } from '../../src/renderer/src/audio/recorder'

interface WorkletMessage {
  type: string
  frames?: Float32Array
}

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null
  readonly messages: WorkletMessage[] = []

  postMessage(message: WorkletMessage): void {
    this.messages.push(message)
  }
}

class FakeAudioWorkletProcessor {
  readonly port = new FakePort()
}

interface Processor extends FakeAudioWorkletProcessor {
  process: (inputs: Float32Array[][]) => boolean
}

function loadProcessor(): new () => Processor {
  let ProcessorClass: (new () => Processor) | undefined
  const source = readFileSync(
    new URL('../../src/renderer/src/audio/pcm-processor.js', import.meta.url),
    'utf8'
  )
  runInNewContext(source, {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    registerProcessor: (_name: string, processor: new () => Processor) => {
      ProcessorClass = processor
    }
  })
  return ProcessorClass!
}

describe('pcm processor protocol', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('emits framed audio and acknowledges shutdown', () => {
    const ProcessorClass = loadProcessor()
    const processor = new ProcessorClass()
    const frame = Float32Array.from([0.25, -0.5])
    expect(processor.process([[frame]])).toBe(true)
    expect(processor.port.messages[0]).toEqual({ type: 'frames', frames: frame })
    processor.port.onmessage?.({ data: { type: 'stop' } })
    expect(processor.port.messages[1]).toEqual({ type: 'drained' })
    expect(processor.process([[frame]])).toBe(false)
  })

  it('drains real processor messages through the recorder consumer', async () => {
    const ProcessorClass = loadProcessor()
    const processor = new ProcessorClass()
    const mainPort: {
      onmessage: ((event: { data: WorkletMessage }) => void) | null
      postMessage: (message: unknown) => void
    } = {
      onmessage: null,
      postMessage: (message) => processor.port.onmessage?.({ data: message })
    }
    processor.port.postMessage = (message) => {
      queueMicrotask(() => mainPort.onmessage?.({ data: message }))
    }
    const stopTrack = vi.fn()
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }))
      }
    })
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function () {
        return {
          audioWorklet: { addModule: vi.fn(async () => {}) },
          createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
          close: vi.fn(async () => {})
        }
      })
    )
    vi.stubGlobal(
      'AudioWorkletNode',
      vi.fn(function () {
        return { port: mainPort, disconnect: vi.fn() }
      })
    )
    const onFrames = vi.fn()
    const recording = await startRecording({ onFrames, batchSamples: 100 })
    processor.process([[Float32Array.from([0.25, -0.5])]])
    await recording.stop()
    expect(onFrames).toHaveBeenCalledOnce()
    expect([...onFrames.mock.calls[0][0]]).toEqual([0.25, -0.5])
    expect(stopTrack).toHaveBeenCalledOnce()
  })
})
