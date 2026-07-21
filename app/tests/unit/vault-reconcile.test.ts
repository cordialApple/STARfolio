import { describe, it, expect } from 'vitest'
import { planReconcile } from '../../src/main/vault/reconcile'
import type { VaultExperience, ParsedNote } from '../../src/main/vault/markdown'

function local(over: Partial<VaultExperience> = {}): VaultExperience {
  return {
    id: 'exp-1',
    title: 'Local',
    situation: 's',
    task: 't',
    action: 'a',
    result_text: 'r',
    context: 'work',
    happened_start: null,
    happened_end: null,
    status: 'confirmed',
    updated_at: '2024-01-01T00:00:00',
    skills: [],
    tags: [],
    metrics: [],
    ...over
  }
}

function note(over: Partial<ParsedNote> = {}): ParsedNote {
  return {
    id: 'exp-1',
    created_at: null,
    updated_at: '2024-01-01T00:00:00',
    title: 'Vault',
    situation: 's',
    task: 't',
    action: 'a',
    result_text: 'r',
    context: 'work',
    happened_start: null,
    happened_end: null,
    status: 'confirmed',
    skills: [],
    tags: [],
    metrics: [],
    ...over
  }
}

describe('planReconcile', () => {
  it('id only in sqlite goes to vault', () => {
    const plan = planReconcile([local({ id: 'only-store' })], [])
    expect(plan.toVault.map((e) => e.id)).toEqual(['only-store'])
    expect(plan.toStore).toEqual([])
  })

  it('id only in vault goes to store', () => {
    const plan = planReconcile([], [note({ id: 'only-vault' })])
    expect(plan.toStore.map((n) => n.id)).toEqual(['only-vault'])
    expect(plan.toVault).toEqual([])
  })

  it('null-id vault note goes to store for import', () => {
    const plan = planReconcile([], [note({ id: null, title: 'Handmade' })])
    expect(plan.toStore.map((n) => n.title)).toEqual(['Handmade'])
    expect(plan.toVault).toEqual([])
  })

  it('newer sqlite side wins (LWW → vault)', () => {
    const plan = planReconcile(
      [local({ updated_at: '2024-06-01T00:00:00' })],
      [note({ updated_at: '2024-01-01T00:00:00' })]
    )
    expect(plan.toVault.map((e) => e.id)).toEqual(['exp-1'])
    expect(plan.toStore).toEqual([])
  })

  it('newer vault side wins (LWW → store)', () => {
    const plan = planReconcile(
      [local({ updated_at: '2024-01-01T00:00:00' })],
      [note({ updated_at: '2024-06-01T00:00:00' })]
    )
    expect(plan.toStore.map((n) => n.id)).toEqual(['exp-1'])
    expect(plan.toVault).toEqual([])
  })

  it('equal timestamps skip both directions (idempotent)', () => {
    const plan = planReconcile([local()], [note()])
    expect(plan.toVault).toEqual([])
    expect(plan.toStore).toEqual([])
  })

  it('coalesces a mixed set additively', () => {
    const plan = planReconcile(
      [local({ id: 'shared', updated_at: '2024-06-01T00:00:00' }), local({ id: 'store-new' })],
      [note({ id: 'shared', updated_at: '2024-01-01T00:00:00' }), note({ id: 'vault-new' })]
    )
    expect(plan.toVault.map((e) => e.id).sort()).toEqual(['shared', 'store-new'])
    expect(plan.toStore.map((n) => n.id).sort()).toEqual(['vault-new'])
  })
})
