import { get } from 'node:http'
import WebSocket from 'ws'
import type { DirectedAction, Roadmap } from '../../ai/roadmap'

export interface DemoConditioning {
  revision: number
  roadmap: Roadmap
  action: DirectedAction
}

export type DemoMode = 'moshi' | 'fixture'
export interface DemoHealth {
  mode: DemoMode
  interviewProtocol: 1
  upstreamReady: boolean
  busy: boolean
}

export type DemoEvent =
  | { type: 'ready'; mode: DemoMode }
  | { type: 'audio'; samples: Float32Array }
  | { type: 'text'; speaker: 'assistant' | 'user'; text: string }
  | {
      type: 'segment'
      speaker: 'candidate' | 'interviewer'
      text: string
      startMs: number
      endMs: number
      truncated: boolean
    }
  | { type: 'gap'; atMs: number }
  | {
      type: 'conditioning'
      revision: number
      status: 'received' | 'consumed' | 'rejected'
      reason?: string
    }
  | { type: 'error'; message: string }
  | { type: 'ended'; reason: string }

export interface DemoEvidence {
  id: string
  title: string
  text: string
}
type EvidenceRecord = {
  id: string
  title: string
  situation: string
  task: string
  action: string
  result_text: string
}

export function selectDemoEvidence(
  ids: string[],
  get: (id: string) => EvidenceRecord | null
): DemoEvidence[] {
  const unique = [...new Set(ids)]
  if (!unique.length || unique.length > 12) throw new Error('Select between 1 and 12 experiences')
  const evidence = unique.map((id) => {
    const item = get(id)
    if (!item) throw new Error('Selected experience no longer exists')
    return {
      id: item.id,
      title: item.title,
      text: `Situation: ${item.situation}\nTask: ${item.task}\nAction: ${item.action}\nResult: ${item.result_text}`
    }
  })
  if (Buffer.byteLength(JSON.stringify(evidence)) > 48_000)
    throw new Error('Selected evidence exceeds 48 KB; choose fewer experiences')
  return evidence
}

function demoUrl(endpoint: string): URL {
  const url = new URL(endpoint)
  if (
    url.protocol !== 'ws:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/session'
  )
    throw new Error('Use the loopback SSM tunnel endpoint, ws://127.0.0.1:8765/session')
  return url
}

export async function checkDemoHealth(endpoint: string): Promise<DemoHealth> {
  const url = demoUrl(endpoint)
  url.protocol = 'http:'
  url.pathname = '/health'
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      let body = ''
      response.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8')
        if (body.length > 4096) request.destroy(new Error('Invalid gateway health response'))
      })
      response.on('error', reject)
      response.on('end', () => {
        try {
          if (response.statusCode !== 200)
            throw new Error(`Gateway health returned HTTP ${response.statusCode}`)
          const result = JSON.parse(body)
          if (
            !['moshi', 'fixture'].includes(result.mode) ||
            result.interviewProtocol !== 1 ||
            typeof result.upstreamReady !== 'boolean' ||
            typeof result.busy !== 'boolean'
          )
            throw new Error('Invalid gateway health response')
          resolve({
            mode: result.mode,
            interviewProtocol: 1,
            upstreamReady: result.upstreamReady,
            busy: result.busy
          })
        } catch (error) {
          reject(error)
        }
      })
    })
    request.setTimeout(8000, () => request.destroy(new Error('Gateway health timed out')))
    request.on('error', reject)
  })
}

export class MoshiDemoSession {
  private socket?: WebSocket
  private endingReason?: string
  private revision = -1
  private ready = false
  private stopped = false
  private deadline?: ReturnType<typeof setTimeout>
  private heartbeat?: ReturnType<typeof setInterval>
  private lastPong = Date.now()
  private rejectStart?: (error: Error) => void

  constructor(private readonly emit: (event: DemoEvent) => void) {}

  async start(
    endpoint: string,
    evidence: DemoEvidence[],
    durationSeconds: number,
    conditioning?: DemoConditioning
  ): Promise<DemoMode> {
    const url = demoUrl(endpoint)
    if (!Number.isInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 1800)
      throw new Error('Session duration must be 60–1800 seconds')
    if (this.socket || this.stopped) throw new Error('Session already started or ended')
    if (conditioning) {
      validateConditioning(conditioning)
      this.revision = conditioning.revision
    }
    return new Promise<DemoMode>((resolve, reject) => {
      this.rejectStart = reject
      const socket = new WebSocket(url, { maxPayload: 256_000, handshakeTimeout: 10_000 })
      this.socket = socket
      this.deadline = setTimeout(
        () => this.fail('Gateway did not become ready within 180 seconds'),
        180_000
      )
      socket.on('open', () => {
        socket.send(
          JSON.stringify({
            type: 'start',
            evidence,
            durationSeconds,
            ...(conditioning ? { conditioning } : {})
          })
        )
        this.lastPong = Date.now()
        this.heartbeat = setInterval(() => {
          if (Date.now() - this.lastPong > 35_000) this.fail('Gateway heartbeat lost')
          else socket.send(JSON.stringify({ type: 'ping' }))
        }, 10_000)
      })
      socket.on('message', (data, binary) => {
        if (this.stopped) return
        try {
          if (binary) {
            if (this.endingReason) return
            const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
            if (!this.ready || bytes.byteLength % 4 || bytes.byteLength > 96_000)
              throw new Error('Invalid gateway audio')
            const samples = new Float32Array(bytes.length / 4)
            for (let i = 0; i < samples.length; i++) {
              const value = bytes.readFloatLE(i * 4)
              if (!Number.isFinite(value)) throw new Error('Invalid gateway audio')
              samples[i] = Math.max(-1, Math.min(1, value))
            }
            this.emit({ type: 'audio', samples })
            return
          }
          const event = JSON.parse(data.toString())
          if (event.type === 'ready' && !this.ready) {
            if (!['moshi', 'fixture'].includes(event.mode)) throw new Error('Unknown gateway mode')
            this.ready = true
            this.rejectStart = undefined
            clearTimeout(this.deadline)
            this.deadline = setTimeout(
              () => this.end('Session time limit reached'),
              durationSeconds * 1000
            )
            this.emit({ type: 'ready', mode: event.mode })
            resolve(event.mode)
          } else if (event.type === 'pong') this.lastPong = Date.now()
          else if (
            event.type === 'text' &&
            ['assistant', 'user'].includes(event.speaker) &&
            typeof event.text === 'string' &&
            event.text.length <= 8000
          )
            this.emit({ type: 'text', speaker: event.speaker, text: event.text })
          else if (event.type === 'segment') {
            if (
              !['candidate', 'interviewer'].includes(event.speaker) ||
              typeof event.text !== 'string' ||
              !event.text.trim() ||
              event.text.length > 8000 ||
              !validTime(event.startMs) ||
              !validTime(event.endMs) ||
              event.endMs < event.startMs ||
              typeof event.truncated !== 'boolean'
            )
              throw new Error('Invalid canonical transcript segment')
            this.emit({
              type: 'segment',
              speaker: event.speaker,
              text: event.text,
              startMs: event.startMs,
              endMs: event.endMs,
              truncated: event.truncated
            })
          } else if (event.type === 'gap') {
            if (!validTime(event.atMs)) throw new Error('Invalid conversational gap')
            this.emit({ type: 'gap', atMs: event.atMs })
          } else if (event.type === 'conditioning') {
            if (
              !Number.isInteger(event.revision) ||
              event.revision < 0 ||
              event.revision > this.revision ||
              !['received', 'consumed', 'rejected'].includes(event.status)
            )
              throw new Error('Invalid conditioning receipt')
            this.emit({
              type: 'conditioning',
              revision: event.revision,
              status: event.status,
              ...(typeof event.reason === 'string' ? { reason: event.reason.slice(0, 1000) } : {})
            })
          } else if (event.type === 'error')
            this.fail(
              typeof event.message === 'string' ? event.message.slice(0, 1000) : 'Gateway error'
            )
          else if (event.type === 'ended')
            this.finish(
              typeof event.reason === 'string'
                ? event.reason.slice(0, 1000)
                : 'Gateway ended session'
            )
        } catch (error) {
          this.fail(error instanceof Error ? error.message : 'Invalid gateway message')
        }
      })
      socket.on('error', (error) => this.fail(error.message))
      socket.on('close', () => this.finish(this.endingReason ?? 'Gateway disconnected'))
    })
  }

  condition(context: DemoConditioning): boolean {
    if (!this.ready || this.stopped || context.revision <= this.revision) return false
    validateConditioning(context)
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    this.revision = context.revision
    this.socket.send(JSON.stringify({ type: 'conditioning', context }))
    return true
  }

  audio(samples: Float32Array): void {
    if (!this.ready || this.stopped || !samples.length) return
    if (
      !(samples instanceof Float32Array) ||
      samples.length > 24_000 ||
      !samples.every(Number.isFinite)
    ) {
      this.fail('Invalid microphone audio')
      return
    }
    if (!this.socket || this.socket.bufferedAmount > 192_000) {
      this.fail('Audio connection too slow')
      return
    }
    const bytes = Buffer.allocUnsafe(samples.length * 4)
    for (let i = 0; i < samples.length; i++)
      bytes.writeFloatLE(Math.max(-1, Math.min(1, samples[i])), i * 4)
    this.socket.send(bytes)
  }

  end(reason = 'Ended by user'): void {
    if (this.stopped || this.endingReason) return
    if (this.revision >= 0 && this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.endingReason = reason
      this.ready = false
      clearTimeout(this.deadline)
      this.socket.send(JSON.stringify({ type: 'end' }))
      this.deadline = setTimeout(() => this.finish('Final transcript flush timed out'), 5000)
      return
    }
    this.finish(reason)
  }

  private finish(reason: string): void {
    if (this.stopped) return
    this.stopped = true
    this.ready = false
    clearTimeout(this.deadline)
    clearInterval(this.heartbeat)
    this.rejectStart?.(new Error(reason))
    this.rejectStart = undefined
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'end' }))
      this.socket.close()
      const socket = this.socket
      const timer = setTimeout(() => socket.terminate(), 2000)
      timer.unref()
    } else this.socket?.terminate()
    this.emit({ type: 'ended', reason })
  }

  private fail(message: string): void {
    if (this.stopped) return
    this.emit({ type: 'error', message })
    this.finish(message)
  }
}

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_810_000
}

function validateConditioning(context: DemoConditioning): void {
  if (
    !Number.isInteger(context.revision) ||
    context.revision < 0 ||
    context.revision > 10000 ||
    !Array.isArray(context.roadmap?.topics) ||
    !Array.isArray(context.roadmap?.objectives) ||
    !['command', 'steer'].includes(context.action?.authority) ||
    !['ask_intro', 'probe', 'transition', 'closing', 'done'].includes(
      context.action?.intent?.kind
    ) ||
    Buffer.byteLength(JSON.stringify(context)) > 24_000
  )
    throw new Error('Invalid or oversized interview conditioning')
}
