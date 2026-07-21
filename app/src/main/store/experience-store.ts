import { getPrefs } from '../settings/prefs'
import {
  createExperience,
  updateExperience,
  deleteExperience,
  getExperience,
  listExperiences,
  listSkills,
  listTags,
  type Experience,
  type ExperienceSummary,
  type Skill,
  type Tag
} from '../db/repositories/experiences'
import { nodeVaultFs } from '../vault/node-fs'
import { experienceToVault } from '../vault/store'
import { mirrorNote, removeNote } from '../vault/sync'

export interface ExperienceStore {
  create(input: unknown): Promise<Experience>
  update(id: string, input: unknown): Promise<Experience>
  delete(id: string): Promise<{ deleted: boolean }>
  get(id: string): Experience | null
  list(filter: unknown): ExperienceSummary[]
  listSkills(): Skill[]
  listTags(): Tag[]
}

export interface VaultMirror {
  mirror(exp: Experience): Promise<void>
  remove(ref: { id: string; title: string }): Promise<void>
}

export const sqliteExperienceStore: ExperienceStore = {
  create: async (input) => createExperience(input),
  update: async (id, input) => updateExperience(id, input),
  delete: async (id) => deleteExperience(id),
  get: (id) => getExperience(id),
  list: (filter) => listExperiences(filter),
  listSkills,
  listTags
}

export function withVaultMirror(base: ExperienceStore, mirror: VaultMirror): ExperienceStore {
  return {
    ...base,
    create: async (input) => {
      const exp = await base.create(input)
      await mirror.mirror(exp)
      return exp
    },
    update: async (id, input) => {
      const exp = await base.update(id, input)
      await mirror.mirror(exp)
      return exp
    },
    delete: async (id) => {
      const exp = base.get(id)
      const res = await base.delete(id)
      if (exp) await mirror.remove({ id: exp.id, title: exp.title })
      return res
    }
  }
}

function vaultMirrorFor(dir: string): VaultMirror {
  return {
    mirror: (exp) => mirrorNote(nodeVaultFs, dir, experienceToVault(exp)),
    remove: (ref) => removeNote(nodeVaultFs, dir, ref)
  }
}

export function getExperienceStore(): ExperienceStore {
  const p = getPrefs()
  if (p.storageMode === 'obsidian' && p.vaultPath)
    return withVaultMirror(sqliteExperienceStore, vaultMirrorFor(p.vaultPath))
  return sqliteExperienceStore
}
