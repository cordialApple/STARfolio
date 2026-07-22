import { describe, it, expect } from 'vitest'
import { structuredProviderFor, transportFor } from '../../src/main/ai/registry'
import { anthropicStructured } from '../../src/main/ai/roles/parse'
import type { ModelSpec } from '../../src/main/ai/routing'

const spec = (provider: ModelSpec['provider']): ModelSpec => ({ provider, model: 'm' })

describe('structuredProviderFor', () => {
  it('returns the anthropic adapter for anthropic specs', () => {
    expect(structuredProviderFor(spec('anthropic'))).toBe(anthropicStructured)
  })

  it('throws until the openai adapter lands', () => {
    expect(() => structuredProviderFor(spec('openai'))).toThrow(/not available yet/)
  })

  it('throws until the gemini adapter lands', () => {
    expect(() => structuredProviderFor(spec('gemini'))).toThrow(/not available yet/)
  })
})

describe('transportFor', () => {
  it('throws until the openai transport lands', () => {
    expect(() => transportFor(spec('openai'))).toThrow(/not available yet/)
  })

  it('throws until the gemini transport lands', () => {
    expect(() => transportFor(spec('gemini'))).toThrow(/not available yet/)
  })
})
