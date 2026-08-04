import { getPrefs, type Prefs } from '../settings/prefs'
import { resolveSpec, toUsageId, type ModelSpec, type RouteEntry, type RoutableRole, type RoutingConfig } from './routing'
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

function resolveRoleEntry(role: RoutableRole, prefs: Prefs): RouteEntry | undefined {
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
    const entry = resolveRoleEntry(role, prefs)
    if (entry) cfg[role] = entry
  }
  return cfg
}

function resolveRoleSpec(role: RoutableRole, cfg: RoutingConfig): ModelSpec | undefined {
  const spec = resolveSpec(role, cfg)
  return spec.provider === 'anthropic' ? undefined : spec
}

function resolveRoleOptions(role: RoutableRole, cfg: RoutingConfig): RoleOptions | undefined {
  const spec = resolveRoleSpec(role, cfg)
  if (!spec) return undefined
  return { provider: structuredProviderFor(spec), model: spec.model, usageId: toUsageId(spec) }
}

export function interviewRuntime(prefs: Prefs = getPrefs()): InterviewRuntime {
  const cfg = routingConfigFromPrefs(prefs)
  const runtime: InterviewRuntime = {}

  const architect = resolveRoleOptions('architect', cfg)
  if (architect) runtime.architect = architect

  const evaluator = resolveRoleOptions('evaluator', cfg)
  if (evaluator) runtime.evaluator = evaluator

  const conversation = resolveRoleSpec('conversation', cfg)
  if (conversation) {
    runtime.conversation = { transport: transportFor(conversation), model: conversation.model, usageId: toUsageId(conversation) }
  }

  return runtime
}
