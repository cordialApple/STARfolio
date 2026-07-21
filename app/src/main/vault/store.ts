import { randomUUID } from 'crypto'
import { getDb } from '../db/client'
import {
  getExperience,
  importExperienceWithId,
  type Experience
} from '../db/repositories/experiences'
import type { VaultExperience } from './markdown'
import { planReconcile } from './reconcile'
import { mirrorNote, readVault, type VaultFs } from './sync'

export function experienceToVault(e: Experience): VaultExperience {
  return {
    id: e.id,
    title: e.title,
    situation: e.situation,
    task: e.task,
    action: e.action,
    result_text: e.result_text,
    context: e.context,
    happened_start: e.happened_start,
    happened_end: e.happened_end,
    status: e.status,
    created_at: e.created_at,
    updated_at: e.updated_at,
    skills: e.skills.map((s) => ({ name: s.name, kind: s.kind })),
    tags: e.tags.map((t) => t.name),
    metrics: e.metrics.map((m) => ({ label: m.label, value: m.value, unit: m.unit }))
  }
}

export function collectVaultExperiences(): VaultExperience[] {
  const ids = (
    getDb().prepare('SELECT id FROM experiences ORDER BY created_at').all() as { id: string }[]
  ).map((r) => r.id)
  return ids.map((id) => experienceToVault(getExperience(id)!))
}

export async function reconcileVault(
  fs: VaultFs,
  dir: string,
  onImport?: (id: string) => void
): Promise<{ imported: number; exported: number }> {
  const plan = planReconcile(collectVaultExperiences(), await readVault(fs, dir))
  for (const n of plan.toStore) {
    const id = n.id ?? randomUUID()
    importExperienceWithId(id, n, { created_at: n.created_at, updated_at: n.updated_at })
    onImport?.(id)
    if (!n.id) await mirrorNote(fs, dir, experienceToVault(getExperience(id)!))
  }
  for (const e of plan.toVault) await mirrorNote(fs, dir, e)
  return { imported: plan.toStore.length, exported: plan.toVault.length }
}
