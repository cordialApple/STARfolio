import { MODELS, type ModelRole } from './models'

export type Provider = 'anthropic' | 'openai' | 'gemini'

export const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'
export const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface ModelSpec {
  provider: Provider
  model: string
  baseUrl?: string
}

export const ROUTABLE_ROLES = ['architect', 'evaluator', 'conversation'] as const
export type RoutableRole = (typeof ROUTABLE_ROLES)[number]

export interface RouteEntry {
  provider: Provider
  model?: string
  baseUrl?: string
}

export type RoutingConfig = Partial<Record<RoutableRole, RouteEntry>>

export function isRoutable(role: ModelRole): role is RoutableRole {
  return (ROUTABLE_ROLES as readonly string[]).includes(role)
}

export function resolveSpec(role: ModelRole, cfg: RoutingConfig = {}): ModelSpec {
  const entry = isRoutable(role) ? cfg[role] : undefined
  const provider = entry?.provider ?? 'anthropic'
  return {
    provider,
    model: entry?.model ?? MODELS[role],
    ...(entry?.baseUrl ? { baseUrl: entry.baseUrl } : {})
  }
}

export function usageId(spec: ModelSpec): string {
  return spec.provider === 'anthropic' ? spec.model : `${spec.provider}:${spec.model}`
}
