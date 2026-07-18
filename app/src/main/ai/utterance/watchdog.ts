import type { AiTransport, StreamRequest, StreamUsage } from '../transport'
import { UtteranceStream, type UtterancePartial } from './stream'

export const STALL_TIMEOUT_MS = 20_000
export const FIRST_TOKEN_TIMEOUT_MS = 12_000
export const STALL_CHECK_MS = 2_000

export interface StallTimer {
  start(onCheck: () => void): void
  stop(): void
}

export function intervalStallTimer(checkMs = STALL_CHECK_MS): StallTimer {
  let handle: ReturnType<typeof setInterval> | undefined
  return {
    start(onCheck) {
      handle = setInterval(onCheck, checkMs)
      handle.unref?.()
    },
    stop() {
      if (handle !== undefined) clearInterval(handle)
      handle = undefined
    }
  }
}

export interface StreamWithWatchdogDeps {
  transport: AiTransport
  request: StreamRequest
  signal?: AbortSignal
  now?: () => number
  stallTimer?: StallTimer
  onToken?: (partial: UtterancePartial) => void
  onDone?: (usage: StreamUsage) => void
}

export async function streamWithWatchdog(deps: StreamWithWatchdogDeps): Promise<string> {
  const clock = deps.now ?? Date.now
  const stream = new UtteranceStream({ now: clock })
  const controller = new AbortController()
  if (deps.signal) {
    if (deps.signal.aborted) controller.abort()
    else deps.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const timer = deps.stallTimer ?? intervalStallTimer()
  const openedAtMs = clock()
  let neverStarted = false
  let stalled = false
  let failure: string | undefined
  timer.start(() => {
    if (controller.signal.aborted) return
    if (!stream.hasStarted) {
      if (clock() - openedAtMs >= FIRST_TOKEN_TIMEOUT_MS) {
        neverStarted = true
        controller.abort()
      }
      return
    }
    if (stream.idleMs(clock()) >= STALL_TIMEOUT_MS) {
      stalled = true
      controller.abort()
    }
  })
  try {
    await deps.transport.stream(deps.request, controller.signal, {
      onToken: (t) => {
        const partial = stream.push(t)
        deps.onToken?.(partial)
      },
      onDone: (usage) => {
        deps.onDone?.(usage)
        const sealed = stream.finish()
        deps.onToken?.(sealed)
      },
      onError: (msg) => {
        failure = msg
      }
    })
  } finally {
    timer.stop()
  }
  if (neverStarted) throw new Error('The interviewer never started composing a reply')
  if (stalled) throw new Error('The interviewer stalled while composing a reply')
  if (controller.signal.aborted) throw new Error('composeUtteranceStream aborted')
  if (failure) throw new Error(failure)
  const text = stream.text()
  if (!text) throw new Error('The model produced an empty utterance')
  return text
}
