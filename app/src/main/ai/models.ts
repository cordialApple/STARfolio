export const MODELS = {
  extract: 'claude-haiku-4-5',
  interview: 'claude-sonnet-5'
} as const

export type ModelRole = keyof typeof MODELS
