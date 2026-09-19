import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createBufferedFrameSink,
  createStreamingFrameSink,
  startRecording
} from '../../src/renderer/src/audio/recorder'

function createFrame(length: number, value: number): Float32Array {
  return new Float32Array(length).fill(value)
}

function createBatchCollector(batchSamples: number) {
  const batches: Float32Array[] = []
  const sink = createStreamingFrameSink({
    onFrames: (audioFrame) => batches.push(audioFrame),
    batchSamples
  })
  return { batches, sink }
}

type WorkletMessage = { type: 'frames'; frames: Float32Array } | { type: 'drained' }

function mockAudioCapture(
  onDrain?: (deliver: (message: WorkletMessage) => void) => void,
  acknowledgeDrain = true
) {
  const stopTrack = vi.fn()
  const closeContext = vi.fn(async () => {})
  const sourceDisconnect = vi.fn()
  const nodeDisconnect = vi.fn()
  const source = { connect: vi.fn(), disconnect: sourceDisconnect }
  const AudioContext = vi.fn(function () {
    return {
      audioWorklet: { addModule: vi.fn(async () => {}) },
      createMediaStreamSource: () => source,
      close: closeContext
    }
  })
  let worklet: {
    port: {
      onmessage: ((event: MessageEvent<WorkletMessage>) => void) | null
      postMessage: (message: { type: 'stop' }) => void
    }
  } | null = null

  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) }
  })
  vi.stubGlobal('AudioContext', AudioContext)
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port: {
        onmessage: ((event: MessageEvent<WorkletMessage>) => void) | null
        postMessage: (message: { type: 'stop' }) => void
      } = {
        onmessage: null,
        postMessage: vi.fn((message) => {
          if (message.type !== 'stop') return
          const deliver = (data: WorkletMessage) =>
            this.port.onmessage?.({ data } as MessageEvent<WorkletMessage>)
          onDrain?.(deliver)
          if (acknowledgeDrain) deliver({ type: 'drained' })
        })
      }
      disconnect = nodeDisconnect
      constructor() {
        worklet = { port: this.port }
      }
    }
  )

  return {
    AudioContext,
    stopTrack,
    closeContext,
    sourceDisconnect,
    nodeDisconnect,
    getWorklet: () => worklet!
  }
}

describe('createBufferedFrameSink', () => {
  it('accumulates every frame and returns Int16 PCM on finish', () => {
    const sink = createBufferedFrameSink()
    sink.push(createFrame(3, 1))
    sink.push(createFrame(2, -1))
    const pcm = sink.finish()
    expect(pcm).toBeInstanceOf(Int16Array)
    expect(pcm.length).toBe(5)
    expect([...pcm.slice(0, 3)]).toEqual([0x7fff, 0x7fff, 0x7fff])
    expect([...pcm.slice(3)]).toEqual([-0x8000, -0x8000])
  })

  it('clamps out-of-range samples before packing', () => {
    const sink = createBufferedFrameSink()
    sink.push(Float32Array.from([2, -2, 0]))
    expect([...sink.finish()]).toEqual([0x7fff, -0x8000, 0])
  })

  it('reports metered level every fourth frame', () => {
    const levels: number[] = []
    const sink = createBufferedFrameSink({ onLevel: (level) => levels.push(level) })
    for (let i = 0; i < 8; i++) sink.push(createFrame(4, 1))
    expect(levels).toHaveLength(2)
    expect(levels[0]).toBeCloseTo(1)
  })
})

describe('createStreamingFrameSink', () => {
  it('returns no session PCM', () => {
    const { sink } = createBatchCollector(4)
    sink.push(createFrame(3, 1))
    sink.push(createFrame(3, 1))
    expect(sink.finish()).toBeUndefined()
  })

  it('emits a batch once batchSamples accumulate', () => {
    const { batches, sink } = createBatchCollector(4)
    sink.push(createFrame(2, 1))
    expect(batches).toHaveLength(0)
    sink.push(createFrame(2, 1))
    expect(batches).toHaveLength(1)
    expect(batches[0].length).toBe(4)
  })

  it('flushes a trailing partial batch on finish', () => {
    const { batches, sink } = createBatchCollector(100)
    sink.push(createFrame(5, 1))
    sink.finish()
    expect(batches).toHaveLength(1)
    expect(batches[0].length).toBe(5)
  })

  it('flushes a trailing partial batch only once', () => {
    const { batches, sink } = createBatchCollector(100)
    sink.push(createFrame(5, 1))
    sink.finish()
    sink.finish()
    expect(batches).toHaveLength(1)
  })

  it('does not flush when nothing is pending', () => {
    const { batches, sink } = createBatchCollector(4)
    sink.push(createFrame(4, 1))
    expect(batches).toHaveLength(1)
    sink.finish()
    expect(batches).toHaveLength(1)
  })

  it('releases pending frames before invoking the callback', () => {
    const onFrames = vi.fn(() => {
      throw new Error('send failed')
    })
    const sink = createStreamingFrameSink({ onFrames, batchSamples: 4 })
    expect(() => sink.push(createFrame(4, 1))).toThrow('send failed')
    expect(sink.finish()).toBeUndefined()
    expect(onFrames).toHaveBeenCalledOnce()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid batch size %s',
    (batchSamples) => {
      expect(() => createStreamingFrameSink({ onFrames: vi.fn(), batchSamples })).toThrow(
        'batchSamples must be a positive integer'
      )
    }
  )

  it('emits sustained frames as bounded ordered batches', () => {
    const { batches, sink } = createBatchCollector(10)
    for (let value = 0; value < 101; value++) sink.push(createFrame(3, value))
    sink.finish()
    expect(batches.map((batch) => batch.length)).toEqual([...Array(25).fill(12), 3])
    expect(batches.flatMap((batch) => [...batch])).toEqual(
      [...Array(101).keys()].flatMap((value) => Array(3).fill(value))
    )
  })
})

describe('startRecording sample rate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([undefined, 24000])(
    'opens requested rate %s and closes microphone on stop',
    async (sampleRate) => {
      const { AudioContext, stopTrack, closeContext } = mockAudioCapture()
      const recording = await startRecording({ sampleRate, onFrames: () => {} })
      expect(AudioContext).toHaveBeenCalledWith({ sampleRate: sampleRate ?? 16000 })
      await recording.stop()
      expect(stopTrack).toHaveBeenCalledOnce()
      expect(closeContext).toHaveBeenCalledOnce()
    }
  )

  it('stops audio resources once', async () => {
    const { stopTrack, closeContext, sourceDisconnect, nodeDisconnect } = mockAudioCapture()
    const recording = await startRecording()
    await Promise.all([recording.stop(), recording.stop()])
    expect(sourceDisconnect).toHaveBeenCalledOnce()
    expect(nodeDisconnect).toHaveBeenCalledOnce()
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(closeContext).toHaveBeenCalledOnce()
  })

  it('flushes the final worklet frame and seals delivery on stop', async () => {
    const onFrames = vi.fn()
    const { getWorklet } = mockAudioCapture((deliver) => {
      deliver({ type: 'frames', frames: createFrame(5, 1) })
    })
    const recording = await startRecording({ onFrames, batchSamples: 100 })
    const worklet = getWorklet()
    await recording.stop()
    expect(onFrames).toHaveBeenCalledOnce()
    expect(onFrames.mock.calls[0][0]).toHaveLength(5)
    expect(worklet.port.onmessage).toBeNull()
  })

  it('flushes accepted frames when context close fails', async () => {
    const onFrames = vi.fn()
    const { closeContext } = mockAudioCapture((deliver) => {
      deliver({ type: 'frames', frames: createFrame(5, 1) })
    })
    closeContext.mockRejectedValueOnce(new Error('close failed'))
    const recording = await startRecording({ onFrames, batchSamples: 100 })
    await expect(recording.stop()).rejects.toThrow('close failed')
    expect(onFrames).toHaveBeenCalledOnce()
  })

  it('reports drain timeout after finishing cleanup', async () => {
    vi.useFakeTimers()
    const { closeContext, nodeDisconnect } = mockAudioCapture(undefined, false)
    const recording = await startRecording({ onFrames: vi.fn() })
    const stopping = recording.stop()
    const timedOut = expect(stopping).rejects.toThrow('Audio worklet drain timed out')
    await vi.runAllTimersAsync()
    await timedOut
    expect(nodeDisconnect).toHaveBeenCalledOnce()
    expect(closeContext).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('accepts queued frames before the drain deadline', async () => {
    vi.useFakeTimers()
    const onFrames = vi.fn()
    const { closeContext } = mockAudioCapture((deliver) => {
      setTimeout(() => {
        deliver({ type: 'frames', frames: createFrame(5, 1) })
        deliver({ type: 'drained' })
      }, 249)
    }, false)
    const recording = await startRecording({ onFrames, batchSamples: 100 })
    const stopping = recording.stop()
    await vi.advanceTimersByTimeAsync(249)
    await stopping
    expect(onFrames).toHaveBeenCalledOnce()
    expect(closeContext).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('does not treat unknown worklet messages as drained', async () => {
    vi.useFakeTimers()
    const { closeContext } = mockAudioCapture((deliver) => {
      deliver({ type: 'unknown' })
    }, false)
    const recording = await startRecording({ onFrames: vi.fn() })
    const stopping = recording.stop()
    const timedOut = expect(stopping).rejects.toThrow('Audio worklet drain timed out')
    await vi.runAllTimersAsync()
    await timedOut
    expect(closeContext).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
