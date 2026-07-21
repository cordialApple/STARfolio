import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initDb } from '../../src/main/db/client'
import { setPrefs } from '../../src/main/settings/prefs'
import {
  sqliteExperienceStore,
  withVaultMirror,
  getExperienceStore,
  type VaultMirror
} from '../../src/main/store/experience-store'

describe('sqliteExperienceStore', () => {
  beforeEach(() => initDb(':memory:'))

  it('round-trips create/get/update/list/delete', async () => {
    const exp = await sqliteExperienceStore.create({ title: 'Shipped', action: 'a' })
    expect(sqliteExperienceStore.get(exp.id)?.title).toBe('Shipped')
    const upd = await sqliteExperienceStore.update(exp.id, { title: 'Shipped v2', action: 'a' })
    expect(upd.title).toBe('Shipped v2')
    expect(sqliteExperienceStore.list({}).map((e) => e.id)).toContain(exp.id)
    expect((await sqliteExperienceStore.delete(exp.id)).deleted).toBe(true)
    expect(sqliteExperienceStore.get(exp.id)).toBeNull()
  })
})

describe('withVaultMirror', () => {
  beforeEach(() => initDb(':memory:'))

  it('mirrors on create/update and removes on delete', async () => {
    const mirrored: string[] = []
    const removed: string[] = []
    const mirror: VaultMirror = {
      mirror: async (e) => void mirrored.push(e.id),
      remove: async (r) => void removed.push(r.id)
    }
    const store = withVaultMirror(sqliteExperienceStore, mirror)
    const exp = await store.create({ title: 'A', action: 'a' })
    await store.update(exp.id, { title: 'B', action: 'a' })
    await store.delete(exp.id)
    expect(mirrored).toEqual([exp.id, exp.id])
    expect(removed).toEqual([exp.id])
  })

  it('skips remove when the id was never stored', async () => {
    const removed: string[] = []
    const mirror: VaultMirror = { mirror: async () => {}, remove: async (r) => void removed.push(r.id) }
    await withVaultMirror(sqliteExperienceStore, mirror).delete('missing')
    expect(removed).toEqual([])
  })
})

describe('getExperienceStore', () => {
  let dir: string
  beforeEach(() => {
    initDb(':memory:')
    dir = mkdtempSync(join(tmpdir(), 'store-vault-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('mirrors a markdown note when storage mode is obsidian', async () => {
    setPrefs({ storageMode: 'obsidian', vaultPath: dir })
    await getExperienceStore().create({ title: 'Vaulted', action: 'a' })
    expect(readdirSync(dir).some((f) => f.endsWith('.md'))).toBe(true)
  })

  it('leaves the vault untouched in sqlite mode', async () => {
    setPrefs({ storageMode: 'sqlite', vaultPath: dir })
    await getExperienceStore().create({ title: 'Local', action: 'a' })
    expect(readdirSync(dir).filter((f) => f.endsWith('.md'))).toEqual([])
  })
})
