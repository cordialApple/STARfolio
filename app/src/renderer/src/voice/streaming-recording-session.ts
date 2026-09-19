import type { Recording } from '../audio/recorder'

export interface StreamingTransport {
  start: (sessionId?: string) => void
  send: (frames: Float32Array) => void
  stop: () => void
}

type OpenRecording = (onFrames: (frames: Float32Array) => void) => Promise<Recording<void>>

export class StreamingRecordingSession {
  private generation = 0
  private recording: Recording<void> | null = null
  private state: 'idle' | 'starting' | 'recording' | 'stopping' = 'idle'
  private stopPromise: Promise<void> | null = null

  constructor(
    private readonly openRecording: OpenRecording,
    private readonly transport: StreamingTransport
  ) {}

  async start(sessionId?: string): Promise<boolean> {
    if (this.state !== 'idle') return false
    const generation = ++this.generation
    this.state = 'starting'
    try {
      this.transport.start(sessionId)
      const recording = await this.openRecording((frames) => {
        if (generation !== this.generation) return
        try {
          this.transport.send(frames)
        } catch {
          void this.stop().catch(() => undefined)
        }
      })
      if (generation !== this.generation) {
        await recording.stop()
        return false
      }
      this.recording = recording
      this.state = 'recording'
      return true
    } catch (error) {
      if (generation !== this.generation) return false
      this.state = 'idle'
      this.stopTransport()
      throw error
    }
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    if (this.state === 'idle') return Promise.resolve()
    const wasStarting = this.state === 'starting'
    const recording = this.recording
    this.recording = null
    this.state = 'stopping'
    if (wasStarting) ++this.generation
    this.stopPromise = (async () => {
      let stopError: unknown
      try {
        await recording?.stop()
      } catch (error) {
        stopError = error
      }
      const transportError = this.stopTransport()
      stopError ??= transportError
      if (!wasStarting) ++this.generation
      this.state = 'idle'
      this.stopPromise = null
      if (stopError) throw stopError
    })()
    return this.stopPromise
  }

  private stopTransport(): unknown {
    try {
      this.transport.stop()
      return undefined
    } catch (error) {
      return error
    }
  }
}
