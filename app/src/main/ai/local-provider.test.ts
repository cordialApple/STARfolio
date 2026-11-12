import { expect, it, vi } from 'vitest'
import { assertLocalMoshiProviders } from './runtime'
import { openaiStructured } from './providers/openai'
import type { Prefs } from '../settings/prefs'
import { z } from 'zod'

const prefs: Prefs = {
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
  experimentalRemoteMoshiEnabled: true,
  providerArchitect: 'openai',
  providerEvaluator: 'openai',
  providerConversation: 'anthropic',
  openaiBaseUrl: 'http://127.0.0.1:11434/v1',
  openaiModelArchitect: 'local-architect',
  openaiModelEvaluator: 'local-evaluator',
  openaiModelConversation: '',
  geminiModelArchitect: '',
  geminiModelEvaluator: '',
  geminiModelConversation: ''
}

it('accepts complete local architect and evaluator routes', () => {
  expect(() => assertLocalMoshiProviders(prefs)).not.toThrow()
})

it('refuses HTTP redirects from a local structured provider', async () => {
  const doFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    new Response('{}', { status: 302 }))
  const provider = openaiStructured({
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: 'synthetic',
    fetch: doFetch
  })
  await expect(provider.parse({
    model: 'local-architect',
    system: 'Synthetic',
    userText: 'Synthetic resume',
    maxTokens: 50,
    schema: z.object({ ok: z.boolean() })
  })).rejects.toThrow()
  expect(doFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
})

it.each([
  { providerArchitect: 'anthropic' },
  { providerEvaluator: 'gemini', geminiModelEvaluator: 'gemini-test' },
  { openaiModelArchitect: '' },
  { openaiBaseUrl: 'https://api.openai.com/v1' },
  { openaiBaseUrl: 'http://localhost:11434/v1' },
  { openaiBaseUrl: 'http://127.0.0.1.attacker.test:11434/v1' },
  { openaiBaseUrl: 'http://user:pass@127.0.0.1:11434/v1' }
] as const satisfies readonly Partial<Prefs>[])('rejects a route that could leave the machine: %j', (patch) => {
  expect(() => assertLocalMoshiProviders({ ...prefs, ...patch })).toThrow('local provider')
})
