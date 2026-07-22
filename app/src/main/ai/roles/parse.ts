import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { getSecret } from '../../settings/secrets'
import { logUsage } from '../usage'
import { resolveAiFetch } from '../fixtures'

export interface StructuredResult {
  stop_reason: string | null
  stop_details?: { category?: string | null } | null
  parsed_output?: unknown
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }
}

export interface StructuredRequest {
  model: string
  system: string
  userText: string
  schema: z.ZodTypeAny
  maxTokens: number
}

export interface StructuredProvider {
  parse(req: StructuredRequest): Promise<StructuredResult>
}

export interface RoleOptions {
  provider?: StructuredProvider
  stub?: boolean
}

export function stubEnabled(stub?: boolean): boolean {
  return stub ?? process.env.STARFOLIO_AI_STUB === '1'
}

interface AnthropicParse {
  messages: { parse(params: unknown): Promise<StructuredResult> }
}

export const anthropicStructured: StructuredProvider = {
  async parse(req) {
    const apiKey = getSecret('anthropic_api_key')
    if (!apiKey) throw new Error('No Anthropic API key configured')
    const client = new Anthropic({ apiKey, fetch: resolveAiFetch() }) as unknown as AnthropicParse
    return client.messages.parse({
      model: req.model,
      max_tokens: req.maxTokens,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.userText }],
      output_config: { format: zodOutputFormat(req.schema) }
    })
  }
}

export interface ParseArgs<S extends z.ZodTypeAny> {
  provider?: StructuredProvider
  model: string
  usageId?: string
  system: string
  userText: string
  schema: S
  feature: string
  maxTokens?: number
  messages?: { declined?: string; failed?: string }
  refusalError?: (stopDetails: StructuredResult['stop_details']) => Error
}

export async function parseStructured<S extends z.ZodTypeAny>(args: ParseArgs<S>): Promise<z.infer<S>> {
  const provider = args.provider ?? anthropicStructured
  const msg = await provider.parse({
    model: args.model,
    system: args.system,
    userText: args.userText,
    schema: args.schema,
    maxTokens: args.maxTokens ?? 2048
  })
  if (msg.stop_reason === 'refusal') {
    if (args.refusalError) throw args.refusalError(msg.stop_details)
    throw new Error(args.messages?.declined ?? 'The model declined to respond')
  }
  if (msg.parsed_output == null)
    throw new Error(`${args.messages?.failed ?? 'Structured call failed'} (stop_reason: ${msg.stop_reason})`)
  logUsage(
    args.usageId ?? args.model,
    {
      in: msg.usage.input_tokens,
      out: msg.usage.output_tokens,
      cacheRead: msg.usage.cache_read_input_tokens ?? 0
    },
    args.feature
  )
  return args.schema.parse(msg.parsed_output)
}
