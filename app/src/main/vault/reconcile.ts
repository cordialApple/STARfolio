import type { ParsedNote, VaultExperience } from './markdown'

export interface ReconcilePlan {
  toVault: VaultExperience[]
  toStore: ParsedNote[]
}

function compareStamp(a: string | null | undefined, b: string | null | undefined): number {
  const x = a ?? ''
  const y = b ?? ''
  return x < y ? -1 : x > y ? 1 : 0
}

export function planReconcile(local: VaultExperience[], vault: ParsedNote[]): ReconcilePlan {
  const vaultById = new Map<string, ParsedNote>()
  const toStore: ParsedNote[] = []
  for (const n of vault) {
    if (n.id) vaultById.set(n.id, n)
    else toStore.push(n)
  }

  const toVault: VaultExperience[] = []
  const seen = new Set<string>()
  for (const e of local) {
    seen.add(e.id)
    const n = vaultById.get(e.id)
    if (!n) {
      toVault.push(e)
      continue
    }
    const cmp = compareStamp(e.updated_at, n.updated_at)
    if (cmp > 0) toVault.push(e)
    else if (cmp < 0) toStore.push(n)
  }

  for (const n of vault) {
    if (n.id && !seen.has(n.id)) toStore.push(n)
  }

  return { toVault, toStore }
}
