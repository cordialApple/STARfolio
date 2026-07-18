import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { getSecret } from '../../settings/secrets'
import { logUsage } from '../usage'
import { resolveAiFetch } from '../fixtures'

export interface ParseClient {
  messages: { parse(params: unknown): Promise<ParseResult> }
}
interface ParseResult {
  stop_reason: string | null
  parsed_output?: unknown
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }
}

export interface RoleOptions {
  client?: ParseClient
  stub?: boolean
}

export function stubEnabled(stub?: boolean): boolean {
  return stub ?? process.env.STARFOLIO_AI_STUB === '1'
}

export function getParseClient(): ParseClient {
  const apiKey = getSecret('anthropic_api_key')
  if (!apiKey) throw new Error('No Anthropic API key configured')
  return new Anthropic({ apiKey, fetch: resolveAiFetch() }) as unknown as ParseClient
}

export interface ParseArgs<S extends z.ZodTypeAny> {
  client: ParseClient
  model: string
  system: string
  userText: string
  schema: S
  feature: string
  maxTokens?: number
  messages?: { declined?: string; failed?: string }
}

export async function parseStructured<S extends z.ZodTypeAny>(args: ParseArgs<S>): Promise<z.infer<S>> {
  const msg = await args.client.messages.parse({
    model: args.model,
    max_tokens: args.maxTokens ?? 2048,
    system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: args.userText }],
    output_config: { format: zodOutputFormat(args.schema) }
  })
  if (msg.stop_reason === 'refusal')
    throw new Error(args.messages?.declined ?? 'The model declined to respond')
  if (msg.parsed_output == null)
    throw new Error(`${args.messages?.failed ?? 'Structured call failed'} (stop_reason: ${msg.stop_reason})`)
  logUsage(
    args.model,
    {
      in: msg.usage.input_tokens,
      out: msg.usage.output_tokens,
      cacheRead: msg.usage.cache_read_input_tokens ?? 0
    },
    args.feature
  )
  return args.schema.parse(msg.parsed_output)
}
