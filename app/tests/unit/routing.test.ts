import { describe, it, expect } from 'vitest'
import {
  ROUTABLE_ROLES,
  isRoutable,
  resolveSpec,
  usageId,
  type RoutingConfig
} from '../../src/main/ai/routing'
import { MODELS } from '../../src/main/ai/models'

describe('resolveSpec', () => {
  it('defaults every role to anthropic with its catalog model', () => {
    for (const role of Object.keys(MODELS) as (keyof typeof MODELS)[]) {
      expect(resolveSpec(role)).toEqual({ provider: 'anthropic', model: MODELS[role] })
    }
  })

  it('routes a routable role to the configured provider and model', () => {
    const cfg: RoutingConfig = { conversation: { provider: 'openai', model: 'llama-3.1', baseUrl: 'http://localhost:11434/v1' } }
    expect(resolveSpec('conversation', cfg)).toEqual({
      provider: 'openai',
      model: 'llama-3.1',
      baseUrl: 'http://localhost:11434/v1'
    })
  })

  it('keeps the catalog model when only the provider is overridden', () => {
    expect(resolveSpec('evaluator', { evaluator: { provider: 'gemini' } })).toEqual({
      provider: 'gemini',
      model: MODELS.evaluator
    })
  })

  it('ignores config for a non-routable role', () => {
    const cfg = { extract: { provider: 'openai' } } as unknown as RoutingConfig
    expect(resolveSpec('extract', cfg)).toEqual({ provider: 'anthropic', model: MODELS.extract })
  })

  it('omits baseUrl when not configured', () => {
    expect(resolveSpec('architect', { architect: { provider: 'openai' } }).baseUrl).toBeUndefined()
  })
})

describe('isRoutable', () => {
  it('is true only for the three high-volume roles', () => {
    for (const role of ROUTABLE_ROLES) expect(isRoutable(role)).toBe(true)
    expect(isRoutable('extract')).toBe(false)
    expect(isRoutable('interview')).toBe(false)
    expect(isRoutable('summary')).toBe(false)
  })
})

describe('usageId', () => {
  it('uses the bare model for anthropic so existing pricing keys stay stable', () => {
    expect(usageId({ provider: 'anthropic', model: 'claude-opus-4-8' })).toBe('claude-opus-4-8')
  })

  it('namespaces non-anthropic providers', () => {
    expect(usageId({ provider: 'openai', model: 'llama-3.1' })).toBe('openai:llama-3.1')
    expect(usageId({ provider: 'gemini', model: 'gemini-2.5-pro' })).toBe('gemini:gemini-2.5-pro')
  })
})
