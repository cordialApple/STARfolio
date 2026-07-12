import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, getDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import {
  passageFor,
  enqueueEmbed,
  backfillEmbeddings,
  pendingEmbedCount
} from '../../src/main/embed/queue'

beforeEach(() => {
  initDb(':memory:')
})

describe('passageFor', () => {
  it('composes title + STAR + skills into one blob', () => {
    const exp = createExperience({
      title: 'Led the rewrite',
      situation: 'Deploys were slow.',
      action: 'Added caching.',
      skills: [{ name: 'CI/CD', kind: 'technical' }]
    } as unknown)
    const passage = passageFor(exp.id)!
    expect(passage).toContain('Led the rewrite')
    expect(passage).toContain('Deploys were slow.')
    expect(passage).toContain('Skills: CI/CD')
  })

  it('returns null for a missing experience', () => {
    expect(passageFor('nope')).toBeNull()
  })
})

describe('embed queue', () => {
  it('enqueue is idempotent per experience', () => {
    const exp = createExperience({ title: 'A' } as unknown)
    enqueueEmbed(exp.id)
    enqueueEmbed(exp.id)
    expect(pendingEmbedCount()).toBe(1)
  })

  it('backfill enqueues only rows without an embedding', () => {
    const a = createExperience({ title: 'A' } as unknown)
    const b = createExperience({ title: 'B' } as unknown)
    getDb()
      .prepare('INSERT INTO vec_experiences (experience_id, embedding) VALUES (?, ?)')
      .run(a.id, new Float32Array(384).fill(0.1))

    backfillEmbeddings()
    const queued = getDb().prepare('SELECT experience_id FROM embed_queue').all() as {
      experience_id: string
    }[]
    expect(queued.map((r) => r.experience_id)).toEqual([b.id])
  })

  it('queue rows cascade-delete with their experience', () => {
    const exp = createExperience({ title: 'A' } as unknown)
    enqueueEmbed(exp.id)
    getDb().prepare('DELETE FROM experiences WHERE id = ?').run(exp.id)
    expect(pendingEmbedCount()).toBe(0)
  })
})
