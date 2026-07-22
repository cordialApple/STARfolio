import { describe, it, expect } from 'vitest'
import { structuredProviderFor, transportFor } from '../../src/main/ai/registry'
import { anthropicStructured } from '../../src/main/ai/roles/parse'
import type { ModelSpec } from '../../src/main/ai/routing'

const spec = (provider: ModelSpec['provider']): ModelSpec => ({ provider, model: 'm' })

describe('structuredProviderFor', () => {
  it('returns the anthropic adapter for anthropic specs', () => {
    expect(structuredProviderFor(spec('anthropic'))).toBe(anthropicStructured)
  })

  it('builds an openai adapter without touching secrets', () => {
    expect(typeof structuredProviderFor(spec('openai')).parse).toBe('function')
  })

  it('throws until the gemini adapter lands', () => {
    expect(() => structuredProviderFor(spec('gemini'))).toThrow(/not available yet/)
  })
})

describe('transportFor', () => {
  it('builds an openai transport without touching secrets', () => {
    expect(typeof transportFor(spec('openai')).stream).toBe('function')
  })

  it('throws until the gemini transport lands', () => {
    expect(() => transportFor(spec('gemini'))).toThrow(/not available yet/)
  })
})
