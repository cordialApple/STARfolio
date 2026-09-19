import { describe, expect, it, vi } from 'vitest'
import type { Recording } from '../../src/renderer/src/audio/recorder'
import { StreamingRecordingSession } from '../../src/renderer/src/voice/streaming-recording-session'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('StreamingRecordingSession', () => {
  it('flushes recorder frames before closing the transport', async () => {
    const events: string[] = []
    let emitFrames!: (frames: Float32Array) => void
    const recording: Recording<void> = {
      stop: vi.fn(async () => emitFrames(new Float32Array([1, 2])))
    }
    const session = new StreamingRecordingSession(
      async (onFrames) => {
        emitFrames = onFrames
        return recording
      },
      {
        start: () => events.push('start'),
        send: () => events.push('frames'),
        stop: () => events.push('stop')
      }
    )
    await session.start('session-1')
    await session.stop()
    expect(events).toEqual(['start', 'frames', 'stop'])
  })

  it('cancels a pending start and closes the late recorder', async () => {
    const opening = deferred<Recording<void>>()
    let emitFrames!: (frames: Float32Array) => void
    const recording = { stop: vi.fn(async () => {}) }
    const transport = { start: vi.fn(), send: vi.fn(), stop: vi.fn() }
    const session = new StreamingRecordingSession((onFrames) => {
      emitFrames = onFrames
      return opening.promise
    }, transport)
    const starting = session.start()
    await session.stop()
    opening.resolve(recording)
    expect(await starting).toBe(false)
    emitFrames(new Float32Array([1]))
    expect(recording.stop).toHaveBeenCalledOnce()
    expect(transport.stop).toHaveBeenCalledOnce()
    expect(transport.send).not.toHaveBeenCalled()
  })

  it('closes the transport when recorder startup fails', async () => {
    const transport = { start: vi.fn(), send: vi.fn(), stop: vi.fn() }
    const session = new StreamingRecordingSession(async () => {
      throw new Error('mic denied')
    }, transport)
    await expect(session.start()).rejects.toThrow('mic denied')
    expect(transport.stop).toHaveBeenCalledOnce()
  })

  it('recovers when transport startup throws', async () => {
    const transport = {
      start: vi.fn(() => {
        throw new Error('start failed')
      }),
      send: vi.fn(),
      stop: vi.fn()
    }
    const session = new StreamingRecordingSession(vi.fn(), transport)
    await expect(session.start()).rejects.toThrow('start failed')
    await expect(session.start()).rejects.toThrow('start failed')
    expect(transport.stop).toHaveBeenCalledTimes(2)
  })

  it('joins concurrent stop calls', async () => {
    const stopping = deferred<void>()
    const transport = { start: vi.fn(), send: vi.fn(), stop: vi.fn() }
    const session = new StreamingRecordingSession(
      async () => ({ stop: () => stopping.promise }),
      transport
    )
    await session.start()
    const first = session.stop()
    const second = session.stop()
    let secondFinished = false
    void second.then(() => {
      secondFinished = true
    })
    await Promise.resolve()
    expect(secondFinished).toBe(false)
    stopping.resolve()
    await Promise.all([first, second])
    expect(transport.stop).toHaveBeenCalledOnce()
  })

  it('resets after transport shutdown fails', async () => {
    const transport = {
      start: vi.fn(),
      send: vi.fn(),
      stop: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('stop failed')
        })
        .mockImplementation(() => {})
    }
    const session = new StreamingRecordingSession(
      async () => ({ stop: vi.fn(async () => {}) }),
      transport
    )
    await session.start()
    await expect(session.stop()).rejects.toThrow('stop failed')
    expect(await session.start()).toBe(true)
    await session.stop()
  })

  it('stops capture when sending frames fails', async () => {
    let emitFrames!: (frames: Float32Array) => void
    const recording = { stop: vi.fn(async () => {}) }
    const transport = {
      start: vi.fn(),
      send: vi.fn(() => {
        throw new Error('send failed')
      }),
      stop: vi.fn()
    }
    const session = new StreamingRecordingSession(async (onFrames) => {
      emitFrames = onFrames
      return recording
    }, transport)
    await session.start()
    expect(() => emitFrames(new Float32Array([1]))).not.toThrow()
    await vi.waitFor(() => expect(recording.stop).toHaveBeenCalledOnce())
    expect(transport.stop).toHaveBeenCalledOnce()
  })

  it('closes transport when recorder shutdown fails', async () => {
    const transport = { start: vi.fn(), send: vi.fn(), stop: vi.fn() }
    const session = new StreamingRecordingSession(
      async () => ({
        stop: vi.fn(async () => {
          throw new Error('recorder failed')
        })
      }),
      transport
    )
    await session.start()
    await expect(session.stop()).rejects.toThrow('recorder failed')
    expect(transport.stop).toHaveBeenCalledOnce()
  })
})
