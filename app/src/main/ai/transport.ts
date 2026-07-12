import Anthropic from '@anthropic-ai/sdk'

export interface StreamUsage {
  in: number
  out: number
  cacheRead: number
}

export interface StreamRequest {
  model: string
  prompt: string
  system?: string
  maxTokens?: number
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onDone: (usage: StreamUsage) => void
  onError: (message: string) => void
}

export interface AiTransport {
  stream(req: StreamRequest, signal: AbortSignal, cb: StreamCallbacks): Promise<void>
}

export function anthropicTransport(apiKey: string): AiTransport {
  const client = new Anthropic({ apiKey })
  return {
    async stream(req, signal, cb): Promise<void> {
      try {
        const stream = client.messages.stream(
          {
            model: req.model,
            max_tokens: req.maxTokens ?? 1024,
            // Stable system prompt cached so repeated generations pay for the grounding
            // instructions once; the per-request experience context stays uncached.
            system: req.system
              ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }]
              : undefined,
            messages: [{ role: 'user', content: req.prompt }]
          },
          { signal }
        )
        stream.on('text', (t) => cb.onToken(t))
        const msg = await stream.finalMessage()
        cb.onDone({
          in: msg.usage.input_tokens,
          out: msg.usage.output_tokens,
          cacheRead: msg.usage.cache_read_input_tokens ?? 0
        })
      } catch (err) {
        if (signal.aborted) return
        cb.onError((err as Error).message)
      }
    }
  }
}

// Deterministic stub — the CI/e2e test seam. No network, no key, no nondeterminism.
export function stubTransport(): AiTransport {
  return {
    async stream(req, signal, cb): Promise<void> {
      const tokens = `stub reply to: ${req.prompt}`.match(/\S+\s*/g) ?? []
      let out = 0
      for (const t of tokens) {
        if (signal.aborted) return
        cb.onToken(t)
        out += 1
      }
      cb.onDone({ in: req.prompt.length, out, cacheRead: 0 })
    }
  }
}
