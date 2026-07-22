import { getSecret } from '../../settings/secrets'
import { resolveAiFetch, type Fetch } from '../fixtures'
import type { StructuredProvider, StructuredResult } from '../roles/parse'
import type { AiTransport } from '../transport'
import { toOpenAiJsonSchema } from './schema'

export type StructuredMode = 'json_schema' | 'json_object'

export interface OpenAiOptions {
  baseUrl: string
  apiKey?: string
  fetch?: Fetch
  structuredMode?: StructuredMode
}

interface OpenAiUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number } | null
}

function mapUsage(u: OpenAiUsage | undefined): StructuredResult['usage'] {
  return {
    input_tokens: u?.prompt_tokens ?? 0,
    output_tokens: u?.completion_tokens ?? 0,
    cache_read_input_tokens: u?.prompt_tokens_details?.cached_tokens ?? 0
  }
}

function resolve(opts: OpenAiOptions): { url: string; key: string; doFetch: Fetch } {
  const key = opts.apiKey ?? getSecret('openai_api_key')
  if (!key) throw new Error('No OpenAI API key configured')
  const doFetch = opts.fetch ?? resolveAiFetch() ?? (globalThis.fetch as Fetch)
  return { url: `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`, key, doFetch }
}

function headers(key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
}

export function openaiStructured(opts: OpenAiOptions): StructuredProvider {
  return {
    async parse(req) {
      const { url, key, doFetch } = resolve(opts)
      const jsonSchema = toOpenAiJsonSchema(req.schema)
      const jsonObject = opts.structuredMode === 'json_object'
      const system = jsonObject
        ? `${req.system}\n\nRespond with a single JSON object matching this schema:\n${JSON.stringify(jsonSchema)}`
        : req.system
      const responseFormat = jsonObject
        ? { type: 'json_object' as const }
        : { type: 'json_schema' as const, json_schema: { name: 'output', strict: false, schema: jsonSchema } }
      const res = await doFetch(url, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: req.userText }
          ],
          response_format: responseFormat
        })
      })
      if (!res.ok) throw new Error(`OpenAI request failed (${res.status})`)
      const json = (await res.json()) as {
        choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[]
        usage?: OpenAiUsage
      }
      const choice = json.choices?.[0]
      const usage = mapUsage(json.usage)
      if (choice?.message?.refusal)
        return { stop_reason: 'refusal', stop_details: { category: 'refusal' }, parsed_output: undefined, usage }
      const content = choice?.message?.content
      return {
        stop_reason: choice?.finish_reason ?? null,
        parsed_output: content ? JSON.parse(content) : undefined,
        usage
      }
    }
  }
}

interface StreamChunk {
  choices?: { delta?: { content?: string | null } }[]
  usage?: OpenAiUsage
}

export function openaiTransport(opts: OpenAiOptions): AiTransport {
  return {
    async stream(req, signal, cb) {
      let usage = { in: 0, out: 0, cacheRead: 0 }
      try {
        const { url, key, doFetch } = resolve(opts)
        const res = await doFetch(url, {
          method: 'POST',
          headers: headers(key),
          signal,
          body: JSON.stringify({
            model: req.model,
            max_tokens: req.maxTokens ?? 1024,
            stream: true,
            stream_options: { include_usage: true },
            messages: [
              ...(req.system ? [{ role: 'system', content: req.system }] : []),
              { role: 'user', content: req.prompt }
            ]
          })
        })
        if (!res.ok || !res.body) throw new Error(`OpenAI request failed (${res.status})`)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (signal.aborted) return
          buf += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') break
            const chunk = JSON.parse(data) as StreamChunk
            const token = chunk.choices?.[0]?.delta?.content
            if (token) cb.onToken(token)
            if (chunk.usage)
              usage = {
                in: chunk.usage.prompt_tokens ?? 0,
                out: chunk.usage.completion_tokens ?? 0,
                cacheRead: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0
              }
          }
        }
        cb.onDone(usage)
      } catch (err) {
        if (signal.aborted) return
        cb.onError((err as Error).message)
      }
    }
  }
}
