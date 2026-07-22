import { getSecret } from '../settings/secrets'
import { anthropicStructured, type StructuredProvider } from './roles/parse'
import { anthropicTransport, type AiTransport } from './transport'
import type { ModelSpec } from './routing'

function notYet(provider: string): never {
  throw new Error(`Provider "${provider}" is not available yet`)
}

export function structuredProviderFor(spec: ModelSpec): StructuredProvider {
  switch (spec.provider) {
    case 'anthropic':
      return anthropicStructured
    default:
      return notYet(spec.provider)
  }
}

export function transportFor(spec: ModelSpec): AiTransport {
  switch (spec.provider) {
    case 'anthropic': {
      const apiKey = getSecret('anthropic_api_key')
      if (!apiKey) throw new Error('No Anthropic API key configured')
      return anthropicTransport(apiKey)
    }
    default:
      return notYet(spec.provider)
  }
}
