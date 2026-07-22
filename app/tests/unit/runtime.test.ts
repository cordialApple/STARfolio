import { describe, it, expect } from 'vitest'
import { routingConfigFromPrefs, interviewRuntime } from '../../src/main/ai/runtime'
import { MODELS } from '../../src/main/ai/models'
import type { Prefs } from '../../src/main/settings/prefs'

const BASE: Prefs = {
  reminderEnabled: false,
  reminderIntervalDays: 14,
  launchAtLogin: false,
  trayResident: false,
  onboardingDone: false,
  reminderSnoozedAt: null,
  voiceModel: 'base.en',
  storageMode: 'sqlite',
  vaultPath: null,
  loopbackEnabled: false,
  providerArchitect: 'anthropic',
  providerEvaluator: 'anthropic',
  providerConversation: 'anthropic',
  openaiBaseUrl: 'http://localhost:11434/v1',
  openaiModelArchitect: '',
  openaiModelEvaluator: '',
  openaiModelConversation: '',
  geminiModelArchitect: '',
  geminiModelEvaluator: '',
  geminiModelConversation: ''
}

const prefs = (over: Partial<Prefs>): Prefs => ({ ...BASE, ...over })

describe('routingConfigFromPrefs', () => {
  it('is empty when every tier defaults to anthropic', () => {
    expect(routingConfigFromPrefs(BASE)).toEqual({})
  })

  it('routes an openai tier with its model and shared base url', () => {
    const cfg = routingConfigFromPrefs(
      prefs({ providerConversation: 'openai', openaiModelConversation: 'llama3.1' })
    )
    expect(cfg).toEqual({
      conversation: { provider: 'openai', model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' }
    })
  })

  it('routes a gemini tier with no base url', () => {
    const cfg = routingConfigFromPrefs(
      prefs({ providerArchitect: 'gemini', geminiModelArchitect: 'gemini-2.5-pro' })
    )
    expect(cfg).toEqual({ architect: { provider: 'gemini', model: 'gemini-2.5-pro' } })
  })

  it('falls back to anthropic when a non-anthropic tier has no model id', () => {
    expect(routingConfigFromPrefs(prefs({ providerEvaluator: 'openai' }))).toEqual({})
    expect(routingConfigFromPrefs(prefs({ providerConversation: 'gemini' }))).toEqual({})
  })

  it('reads each tier from its own provider and model keys', () => {
    const cfg = routingConfigFromPrefs(
      prefs({
        providerArchitect: 'gemini',
        geminiModelArchitect: 'gemini-2.5-pro',
        providerConversation: 'openai',
        openaiModelConversation: 'llama3.1'
      })
    )
    expect(cfg).toEqual({
      architect: { provider: 'gemini', model: 'gemini-2.5-pro' },
      conversation: { provider: 'openai', model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' }
    })
  })
})

describe('interviewRuntime', () => {
  it('is empty when every tier is anthropic', () => {
    expect(interviewRuntime(BASE)).toEqual({})
  })

  it('builds role options carrying the model and namespaced usage id', () => {
    const rt = interviewRuntime(
      prefs({ providerEvaluator: 'openai', openaiModelEvaluator: 'llama3.1' })
    )
    expect(rt.evaluator?.model).toBe('llama3.1')
    expect(rt.evaluator?.usageId).toBe('openai:llama3.1')
    expect(rt.evaluator?.provider).toBeDefined()
    expect(rt.architect).toBeUndefined()
  })

  it('gives the conversation tier a transport plus model and usage id', () => {
    const rt = interviewRuntime(
      prefs({ providerConversation: 'gemini', geminiModelConversation: 'gemini-2.5-flash' })
    )
    expect(rt.conversation?.transport).toBeDefined()
    expect(rt.conversation?.model).toBe('gemini-2.5-flash')
    expect(rt.conversation?.usageId).toBe('gemini:gemini-2.5-flash')
  })

  it('omits a half-configured tier rather than routing a claude model off-provider', () => {
    const rt = interviewRuntime(prefs({ providerConversation: 'openai' }))
    expect(rt.conversation).toBeUndefined()
    expect(interviewRuntime(BASE)).not.toHaveProperty('evaluator')
    expect(MODELS.conversation).toBeTruthy()
  })
})
