import Anthropic from '@anthropic-ai/sdk'

export interface StreamUsage {
  in: number
  out: number
  cacheRead: number
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onDone: (usage: StreamUsage) => void
  onError: (message: string) => void
}

export interface AiTransport {
  model: string
  stream(prompt: string, signal: AbortSignal, cb: StreamCallbacks): Promise<void>
}

export function anthropicTransport(apiKey: string, model: string): AiTransport {
  const client = new Anthropic({ apiKey })
  return {
    model,
    async stream(prompt, signal, cb): Promise<void> {
      try {
        const stream = client.messages.stream(
          { model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] },
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
export function stubTransport(model = 'stub'): AiTransport {
  return {
    model,
    async stream(prompt, signal, cb): Promise<void> {
      const tokens = `stub reply to: ${prompt}`.match(/\S+\s*/g) ?? []
      let out = 0
      for (const t of tokens) {
        if (signal.aborted) return
        cb.onToken(t)
        out += 1
      }
      cb.onDone({ in: prompt.length, out, cacheRead: 0 })
    }
  }
}
