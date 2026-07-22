import { getSecret } from '../settings/secrets'
import { anthropicStructured, type StructuredProvider } from './roles/parse'
import { anthropicTransport, type AiTransport } from './transport'
import { openaiStructured, openaiTransport } from './providers/openai'
import { geminiStructured, geminiTransport } from './providers/gemini'
import { DEFAULT_OPENAI_BASE, DEFAULT_GEMINI_BASE, type ModelSpec } from './routing'

function notYet(provider: string): never {
  throw new Error(`Provider "${provider}" is not available yet`)
}

export function structuredProviderFor(spec: ModelSpec): StructuredProvider {
  switch (spec.provider) {
    case 'anthropic':
      return anthropicStructured
    case 'openai':
      return openaiStructured({ baseUrl: spec.baseUrl ?? DEFAULT_OPENAI_BASE })
    case 'gemini':
      return geminiStructured({ baseUrl: spec.baseUrl ?? DEFAULT_GEMINI_BASE })
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
    case 'openai':
      return openaiTransport({ baseUrl: spec.baseUrl ?? DEFAULT_OPENAI_BASE })
    case 'gemini':
      return geminiTransport({ baseUrl: spec.baseUrl ?? DEFAULT_GEMINI_BASE })
    default:
      return notYet(spec.provider)
  }
}
