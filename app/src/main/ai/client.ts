import type { WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { getSecret } from '../settings/secrets'
import { getDb } from '../db/client'
import { anthropicTransport, stubTransport, type AiTransport, type StreamUsage } from './transport'

const HAIKU = 'claude-haiku-4-5'

const active = new Map<string, AbortController>()

function resolveTransport(): AiTransport {
  if (process.env.STARFOLIO_AI_STUB === '1') return stubTransport(HAIKU)
  const apiKey = getSecret('anthropic_api_key')
  if (!apiKey) throw new Error('No Anthropic API key configured')
  return anthropicTransport(apiKey, HAIKU)
}

function logUsage(model: string, usage: StreamUsage): void {
  getDb()
    .prepare(
      'INSERT INTO usage_log (id, model, in_tokens, out_tokens, cache_read_tokens, feature) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(randomUUID(), model, usage.in, usage.out, usage.cacheRead, 'spike')
}

export function startStream(prompt: string, requestId: string, sender: WebContents): void {
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
    .stream(prompt, ac.signal, {
      onToken: (t) => send('ai:token', t),
      onDone: (usage) => {
        try {
          logUsage(transport.model, usage)
        } catch {
          // usage logging must never break the stream response
        }
        active.delete(requestId)
        send('ai:done')
      },
      onError: (msg) => {
        active.delete(requestId)
        send('ai:error', msg)
      }
    })
    .catch((err) => {
      active.delete(requestId)
      send('ai:error', (err as Error).message)
    })
}

export function cancelStream(requestId: string): void {
  active.get(requestId)?.abort()
  active.delete(requestId)
}
