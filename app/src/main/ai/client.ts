import type { WebContents } from 'electron'
import { getSecret } from '../settings/secrets'
import { anthropicTransport, stubTransport, type AiTransport } from './transport'
import { MODELS } from './models'
import { logUsage } from './usage'

const active = new Map<string, AbortController>()

function resolveTransport(): AiTransport {
  if (process.env.STARFOLIO_AI_STUB === '1') return stubTransport(MODELS.extract)
  const apiKey = getSecret('anthropic_api_key')
  if (!apiKey) throw new Error('No Anthropic API key configured')
  return anthropicTransport(apiKey, MODELS.extract)
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
        logUsage(transport.model, usage, 'chat')
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
