import { dirname } from 'path'

export interface PersonalServerConfig {
  version: 1
  backend: 'vault' | 'sqlite'
  vaultPath: string | null
  dbPath: string | null
  source: 'starfolio'
}

export interface PrefsSlice {
  storageMode: 'sqlite' | 'obsidian'
  vaultPath: string | null
}

export function mapPrefsToConfig(prefs: PrefsSlice, dbPath: string): PersonalServerConfig {
  const useVault = prefs.storageMode === 'obsidian' && !!prefs.vaultPath
  return {
    version: 1,
    backend: useVault ? 'vault' : 'sqlite',
    vaultPath: useVault ? prefs.vaultPath : null,
    dbPath,
    source: 'starfolio'
  }
}

export function buildConfigJson(prevRaw: string | null, config: PersonalServerConfig, nowUtc: string): string {
  let prev: Record<string, unknown> = {}
  if (prevRaw) {
    try {
      const parsed: unknown = JSON.parse(prevRaw)
      if (parsed && typeof parsed === 'object') prev = parsed as Record<string, unknown>
    } catch {
      prev = {}
    }
  }
  const merged = { ...prev, ...config, updatedUtc: nowUtc }
  return JSON.stringify(merged, null, 2) + '\n'
}

export interface ConfigFs {
  exists(path: string): boolean
  read(path: string): string
  write(path: string, data: string): void
  rename(from: string, to: string): void
  mkdir(dir: string): void
}

export function writeConfigAtomic(fs: ConfigFs, filePath: string, json: string): void {
  fs.mkdir(dirname(filePath))
  const tmp = filePath + '.tmp'
  fs.write(tmp, json)
  fs.rename(tmp, filePath)
}
