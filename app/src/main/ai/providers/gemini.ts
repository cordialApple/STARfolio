import { getSecret } from '../../settings/secrets'
import { resolveAiFetch, type Fetch } from '../fixtures'
import type { StructuredProvider, StructuredResult } from '../roles/parse'
import type { AiTransport } from '../transport'
import { toGeminiSchema } from './schema'

export { toGeminiSchema }

export interface GeminiOptions {
  baseUrl: string
  apiKey?: string
  fetch?: Fetch
}

interface GeminiUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
  cachedContentTokenCount?: number
}

const REFUSAL_REASONS = new Set(['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'RECITATION'])

function mapUsage(u: GeminiUsage | undefined): StructuredResult['usage'] {
  return {
    input_tokens: u?.promptTokenCount ?? 0,
    output_tokens: u?.candidatesTokenCount ?? 0,
    cache_read_input_tokens: u?.cachedContentTokenCount ?? 0
  }
}

function resolve(opts: GeminiOptions): { key: string; base: string; doFetch: Fetch } {
  const key = opts.apiKey ?? getSecret('gemini_api_key')
  if (!key) throw new Error('No Gemini API key configured')
  const doFetch = opts.fetch ?? resolveAiFetch() ?? (globalThis.fetch as Fetch)
  return { key, base: opts.baseUrl.replace(/\/+$/, ''), doFetch }
}

function headers(key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': key }
}

function partsText(parts: { text?: string }[] | undefined): string {
  return (parts ?? []).map((p) => p.text ?? '').join('')
}

export function geminiStructured(opts: GeminiOptions): StructuredProvider {
  return {
    async parse(req) {
      const { key, base, doFetch } = resolve(opts)
      const res = await doFetch(`${base}/models/${req.model}:generateContent`, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.userText }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(req.schema),
            maxOutputTokens: req.maxTokens
          }
        })
      })
      if (!res.ok) throw new Error(`Gemini request failed (${res.status})`)
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
        promptFeedback?: { blockReason?: string }
        usageMetadata?: GeminiUsage
      }
      const cand = json.candidates?.[0]
      const usage = mapUsage(json.usageMetadata)
      const reason = cand?.finishReason
      const block = json.promptFeedback?.blockReason
      if (block || (reason && REFUSAL_REASONS.has(reason)))
        return { stop_reason: 'refusal', stop_details: { category: block ?? reason }, parsed_output: undefined, usage }
      const text = partsText(cand?.content?.parts)
      return { stop_reason: reason ?? null, parsed_output: text ? JSON.parse(text) : undefined, usage }
    }
  }
}

interface StreamResp {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
  usageMetadata?: GeminiUsage
}

export function geminiTransport(opts: GeminiOptions): AiTransport {
  return {
    async stream(req, signal, cb) {
      let usage = { in: 0, out: 0, cacheRead: 0 }
      try {
        const { key, base, doFetch } = resolve(opts)
        const res = await doFetch(`${base}/models/${req.model}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers: headers(key),
          signal,
          body: JSON.stringify({
            ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
            contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
            generationConfig: { maxOutputTokens: req.maxTokens ?? 1024 }
          })
        })
        if (!res.ok || !res.body) throw new Error(`Gemini request failed (${res.status})`)
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
            if (!data) continue
            const chunk = JSON.parse(data) as StreamResp
            const token = partsText(chunk.candidates?.[0]?.content?.parts)
            if (token) cb.onToken(token)
            if (chunk.usageMetadata)
              usage = {
                in: chunk.usageMetadata.promptTokenCount ?? 0,
                out: chunk.usageMetadata.candidatesTokenCount ?? 0,
                cacheRead: chunk.usageMetadata.cachedContentTokenCount ?? 0
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
