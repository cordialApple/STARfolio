import { getSecret } from '../settings/secrets'
import { anthropicTransport, stubTransport, type AiTransport } from './transport'

export function resolveTransport(): AiTransport {
  if (process.env.STARFOLIO_AI_STUB === '1') return stubTransport()
  const apiKey = getSecret('anthropic_api_key')
  if (!apiKey) throw new Error('No Anthropic API key configured')
  return anthropicTransport(apiKey)
}
