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

  it('builds a gemini adapter without touching secrets', () => {
    expect(typeof structuredProviderFor(spec('gemini')).parse).toBe('function')
  })
})

describe('transportFor', () => {
  it('builds an openai transport without touching secrets', () => {
    expect(typeof transportFor(spec('openai')).stream).toBe('function')
  })

  it('builds a gemini transport without touching secrets', () => {
    expect(typeof transportFor(spec('gemini')).stream).toBe('function')
  })
})
