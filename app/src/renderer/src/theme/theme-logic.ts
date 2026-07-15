export type ThemeMode = 'system' | 'light' | 'dark'

export const MODES: ThemeMode[] = ['system', 'light', 'dark']

export function normalizeMode(raw: string | null): ThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

export function nextMode(current: ThemeMode): ThemeMode {
  return MODES[(MODES.indexOf(current) + 1) % MODES.length]
}

export function resolveMode(mode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
}
