import { createWriteStream, mkdirSync, renameSync, writeFileSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

type Phase = 'health' | 'brain' | 'ready'

interface TrialCaptureOptions {
  root: string
  sessionId: string
  trialId: string | null
  recordMedia: boolean
  now?: () => number
  startedMs?: number
  startedAtUtc?: string
  onMediaError?: (message: string) => void
}

export class TrialCapture {
  private readonly directory: string
  private readonly startedMs: number
  private readonly startedAtUtc: string
  private readonly sessionId: string
  private readonly trialId: string | null
  private readonly mediaRecorded: boolean
  private readonly now: () => number
  private readonly onMediaError?: (message: string) => void
  private readonly phasesMs: Partial<Record<Phase, number>> = {}
  private readonly gapToAudioMs: number[] = []
  private readonly pingRttMs: number[] = []
  private inputStream?: WriteStream
  private outputStream?: WriteStream
  private pendingGapMs: number | null = null
  private lastSnapshotMs: number
  private gapCount = 0
  private inputSamples = 0
  private outputSamples = 0
  private mediaError: string | null = null
  private finished = false

  constructor(options: TrialCaptureOptions) {
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(options.sessionId)) throw new Error('Invalid trial session ID')
    this.sessionId = options.sessionId
    this.trialId = options.trialId
    this.mediaRecorded = options.recordMedia
    this.now = options.now ?? (() => performance.now())
    this.onMediaError = options.onMediaError
    this.directory = join(options.root, options.sessionId)
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    this.startedMs = options.startedMs ?? this.now()
    this.startedAtUtc = options.startedAtUtc ?? new Date().toISOString()
    this.lastSnapshotMs = this.startedMs
    if (this.mediaRecorded) {
      this.inputStream = this.stream('input.f32le')
      this.outputStream = this.stream('output.f32le')
    }
    this.snapshot('active', null, null)
  }

  phase(phase: Phase): void {
    if (this.finished || this.phasesMs[phase] !== undefined) return
    this.phasesMs[phase] = Math.max(0, Math.round(this.now() - this.startedMs))
    this.snapshot('active', null, null)
  }

  gap(): void {
    if (this.finished) return
    this.gapCount++
    this.pendingGapMs = this.now()
    this.snapshot('active', null, null)
  }

  input(samples: Float32Array): void {
    if (this.finished) return
    this.inputSamples += samples.length
    this.writeAudio(this.inputStream, samples)
    this.snapshotIfDue()
  }

  output(samples: Float32Array): void {
    if (this.finished) return
    this.outputSamples += samples.length
    if (this.pendingGapMs !== null) {
      this.gapToAudioMs.push(Math.max(0, Math.round(this.now() - this.pendingGapMs)))
      this.pendingGapMs = null
      this.snapshot('active', null, null)
    }
    this.writeAudio(this.outputStream, samples)
    this.snapshotIfDue()
  }

  ping(roundTripMs: number): void {
    if (this.finished || !Number.isFinite(roundTripMs) || roundTripMs < 0) return
    this.pingRttMs.push(Math.round(roundTripMs))
    this.snapshot('active', null, null)
  }

  async finish(reason: string, complete: boolean): Promise<void> {
    if (this.finished) return
    this.finished = true
    await Promise.all([this.endStream(this.inputStream), this.endStream(this.outputStream)])
    this.snapshot(
      complete && !this.mediaError ? 'finished' : 'incomplete',
      reason,
      new Date().toISOString()
    )
  }

  private stream(name: string): WriteStream {
    const stream = createWriteStream(join(this.directory, name), { flags: 'wx', mode: 0o600 })
    stream.on('error', (error) => {
      this.failMedia(error.message)
    })
    return stream
  }

  private writeAudio(stream: WriteStream | undefined, samples: Float32Array): void {
    if (!stream || this.mediaError || stream.destroyed) return
    if (stream.writableLength > 1_000_000) {
      this.failMedia('Media writer fell behind')
      stream.destroy()
      return
    }
    stream.write(
      Buffer.from(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength))
    )
  }

  private failMedia(message: string): void {
    if (this.mediaError) return
    this.mediaError = message
    this.onMediaError?.(message)
  }

  private endStream(stream: WriteStream | undefined): Promise<void> {
    if (!stream || stream.destroyed) return Promise.resolve()
    return new Promise((resolve) => {
      stream.once('close', resolve)
      stream.end()
    })
  }

  private snapshotIfDue(): void {
    const current = this.now()
    if (current - this.lastSnapshotMs < 5000) return
    this.snapshot('active', null, null)
  }

  private snapshot(
    status: 'active' | 'finished' | 'incomplete',
    reason: string | null,
    endedAtUtc: string | null
  ): void {
    this.lastSnapshotMs = this.now()
    const data = {
      schemaVersion: 1,
      sessionId: this.sessionId,
      trialId: this.trialId,
      startedAtUtc: this.startedAtUtc,
      endedAtUtc,
      status,
      reason,
      sampleRateHz: 24_000,
      mediaRecorded: this.mediaRecorded,
      mediaError: this.mediaError,
      phasesMs: this.phasesMs,
      gapCount: this.gapCount,
      gapToAudioMs: this.gapToAudioMs,
      pingRttMs: this.pingRttMs,
      inputSamples: this.inputSamples,
      outputSamples: this.outputSamples,
      durationMs: Math.max(0, Math.round(this.now() - this.startedMs))
    }
    const temporary = join(this.directory, `manifest.${randomUUID()}.tmp`)
    writeFileSync(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, join(this.directory, 'manifest.json'))
  }
}
