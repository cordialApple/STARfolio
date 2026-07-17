import type { WebContents } from 'electron'
import { type AiTransport } from './transport'
import { resolveTransport } from './resolve-transport'
import { MODELS } from './models'
import { logUsage } from './usage'

const active = new Map<string, AbortController>()

export interface StreamJob {
  prompt: string
  system?: string
  model: string
  maxTokens?: number
  feature: string
}

export function startStream(job: StreamJob, requestId: string, sender: WebContents): void {
  // Persistent request-id-keyed channels + caller-supplied requestId: the renderer subscribes
  // once and knows the id before invoking, so synchronously-emitted tokens are never missed.
  const send = (channel: string, ...args: unknown[]): void => {
    if (!sender.isDestroyed()) sender.send(channel, requestId, ...args)
  }

  let transport: AiTransport
  try {
    transport = resolveTransport()
  } catch (err) {
    queueMicrotask(() => send('ai:error', (err as Error).message))
    return
  }

  const ac = new AbortController()
  active.set(requestId, ac)

  transport
    .stream(
      { model: job.model, prompt: job.prompt, system: job.system, maxTokens: job.maxTokens },
      ac.signal,
      {
        onToken: (t) => send('ai:token', t),
        onDone: (usage) => {
          logUsage(job.model, usage, job.feature)
          active.delete(requestId)
          send('ai:done')
        },
        onError: (msg) => {
          active.delete(requestId)
          send('ai:error', msg)
        }
      }
    )
    .catch((err) => {
      active.delete(requestId)
      send('ai:error', (err as Error).message)
    })
}

export function startChat(prompt: string, requestId: string, sender: WebContents): void {
  startStream({ prompt, model: MODELS.extract, feature: 'chat' }, requestId, sender)
}

// Non-streaming variant: accumulate the whole generation into one string. Used by callers with
// no WebContents to stream to (e.g. the loopback bridge), which need a single buffered result.
export function runToCompletion(job: StreamJob, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let transport: AiTransport
    try {
      transport = resolveTransport()
    } catch (err) {
      reject(err)
      return
    }
    let out = ''
    transport
      .stream(
        { model: job.model, prompt: job.prompt, system: job.system, maxTokens: job.maxTokens },
        signal,
        {
          onToken: (t) => {
            out += t
          },
          onDone: (usage) => {
            logUsage(job.model, usage, job.feature)
            resolve(out)
          },
          onError: (msg) => reject(new Error(msg))
        }
      )
      .catch(reject)
  })
}

export function cancelStream(requestId: string): void {
  active.get(requestId)?.abort()
  active.delete(requestId)
}
