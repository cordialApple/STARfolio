import { describe, it, expect } from 'vitest'
import {
  mapPrefsToConfig,
  buildConfigJson,
  writeConfigAtomic,
  type ConfigFs,
  type PrefsSlice
} from '../../src/main/integration/personalserver-config'

const DB = '/data/superstar.db'

describe('mapPrefsToConfig', () => {
  const rows: Array<[string, PrefsSlice, { backend: string; vaultPath: string | null }]> = [
    ['obsidian + vaultPath -> vault', { storageMode: 'obsidian', vaultPath: '/vault' }, { backend: 'vault', vaultPath: '/vault' }],
    ['sqlite -> sqlite', { storageMode: 'sqlite', vaultPath: null }, { backend: 'sqlite', vaultPath: null }],
    ['obsidian + null vaultPath -> sqlite (fallback)', { storageMode: 'obsidian', vaultPath: null }, { backend: 'sqlite', vaultPath: null }],
    ['sqlite ignores a stale vaultPath', { storageMode: 'sqlite', vaultPath: '/vault' }, { backend: 'sqlite', vaultPath: null }]
  ]
  for (const [name, prefs, want] of rows) {
    it(name, () => {
      const c = mapPrefsToConfig(prefs, DB)
      expect(c.backend).toBe(want.backend)
      expect(c.vaultPath).toBe(want.vaultPath)
      expect(c.dbPath).toBe(DB)
      expect(c.version).toBe(1)
      expect(c.source).toBe('starfolio')
    })
  }
})

describe('buildConfigJson', () => {
  const config = mapPrefsToConfig({ storageMode: 'obsidian', vaultPath: '/vault' }, DB)

  it('stamps updatedUtc and serializes the schema', () => {
    const parsed = JSON.parse(buildConfigJson(null, config, '2026-07-21T12:00:00Z'))
    expect(parsed).toMatchObject({ ...config, updatedUtc: '2026-07-21T12:00:00Z' })
  })

  it('preserves unknown keys from a prior file', () => {
    const prev = JSON.stringify({ backend: 'sqlite', ownedByPersonalServer: { foo: 1 } })
    const parsed = JSON.parse(buildConfigJson(prev, config, '2026-07-21T12:00:00Z'))
    expect(parsed.ownedByPersonalServer).toEqual({ foo: 1 })
    expect(parsed.backend).toBe('vault')
  })

  it('ignores an unparseable prior file', () => {
    const parsed = JSON.parse(buildConfigJson('{ not json', config, '2026-07-21T12:00:00Z'))
    expect(parsed.backend).toBe('vault')
  })
})

describe('writeConfigAtomic', () => {
  it('creates the parent dir then writes tmp before renaming over the target', () => {
    const calls: string[] = []
    const store = new Map<string, string>()
    const fs: ConfigFs = {
      exists: (p) => store.has(p),
      read: (p) => store.get(p) ?? '',
      write: (p, data) => {
        calls.push(`write:${p}`)
        store.set(p, data)
      },
      rename: (from, to) => {
        calls.push(`rename:${from}->${to}`)
        store.set(to, store.get(from) ?? '')
        store.delete(from)
      },
      mkdir: (dir) => calls.push(`mkdir:${dir}`)
    }
    writeConfigAtomic(fs, '/cfg/PersonalServer/config.json', '{}\n')
    expect(calls).toEqual([
      'mkdir:/cfg/PersonalServer',
      'write:/cfg/PersonalServer/config.json.tmp',
      'rename:/cfg/PersonalServer/config.json.tmp->/cfg/PersonalServer/config.json'
    ])
    expect(store.get('/cfg/PersonalServer/config.json')).toBe('{}\n')
    expect(store.has('/cfg/PersonalServer/config.json.tmp')).toBe(false)
  })
})
