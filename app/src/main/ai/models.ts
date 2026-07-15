export const MODELS = {
  extract: 'claude-haiku-4-5',
  interview: 'claude-sonnet-5',
  architect: 'claude-opus-4-8',
  evaluator: 'claude-sonnet-5',
  conversation: 'claude-haiku-4-5'
} as const

export type ModelRole = keyof typeof MODELS
