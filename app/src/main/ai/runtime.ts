import { getPrefs, type Prefs } from '../settings/prefs'
import { resolveSpec, usageId, type ModelSpec, type RouteEntry, type RoutableRole, type RoutingConfig } from './routing'
import { structuredProviderFor, transportFor } from './registry'
import type { RoleOptions } from './roles/parse'
import type { InterviewRuntime } from './session'

interface RolePrefKeys {
  provider: keyof Prefs
  openaiModel: keyof Prefs
  geminiModel: keyof Prefs
}

const ROLE_PREF_KEYS: Record<RoutableRole, RolePrefKeys> = {
  architect: {
    provider: 'providerArchitect',
    openaiModel: 'openaiModelArchitect',
    geminiModel: 'geminiModelArchitect'
  },
  evaluator: {
    provider: 'providerEvaluator',
    openaiModel: 'openaiModelEvaluator',
    geminiModel: 'geminiModelEvaluator'
  },
  conversation: {
    provider: 'providerConversation',
    openaiModel: 'openaiModelConversation',
    geminiModel: 'geminiModelConversation'
  }
}

function entryForRole(role: RoutableRole, prefs: Prefs): RouteEntry | undefined {
  const keys = ROLE_PREF_KEYS[role]
  const provider = prefs[keys.provider] as RouteEntry['provider']
  if (provider === 'anthropic') return undefined
  const model = (provider === 'openai' ? prefs[keys.openaiModel] : prefs[keys.geminiModel]) as string
  // Half-configured install: non-anthropic provider with no model would ship a claude id
  // to openai/gemini — fall back to anthropic instead of crashing the interview.
  if (!model) return undefined
  return provider === 'openai'
    ? { provider, model, baseUrl: prefs.openaiBaseUrl }
    : { provider, model }
}

export function routingConfigFromPrefs(prefs: Prefs): RoutingConfig {
  const cfg: RoutingConfig = {}
  for (const role of Object.keys(ROLE_PREF_KEYS) as RoutableRole[]) {
    const entry = entryForRole(role, prefs)
    if (entry) cfg[role] = entry
  }
  return cfg
}

function specFor(role: RoutableRole, cfg: RoutingConfig): ModelSpec | undefined {
  const spec = resolveSpec(role, cfg)
  return spec.provider === 'anthropic' ? undefined : spec
}

function roleOptionsFor(role: RoutableRole, cfg: RoutingConfig): RoleOptions | undefined {
  const spec = specFor(role, cfg)
  if (!spec) return undefined
  return { provider: structuredProviderFor(spec), model: spec.model, usageId: usageId(spec) }
}

export function interviewRuntime(prefs: Prefs = getPrefs()): InterviewRuntime {
  const cfg = routingConfigFromPrefs(prefs)
  const runtime: InterviewRuntime = {}

  const architect = roleOptionsFor('architect', cfg)
  if (architect) runtime.architect = architect

  const evaluator = roleOptionsFor('evaluator', cfg)
  if (evaluator) runtime.evaluator = evaluator

  const conversation = specFor('conversation', cfg)
  if (conversation) {
    runtime.conversation = { transport: transportFor(conversation), model: conversation.model, usageId: usageId(conversation) }
  }

  return runtime
}
