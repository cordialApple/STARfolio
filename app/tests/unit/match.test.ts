import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, getDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { matchBankedStory, STORY_MATCH_THRESHOLD } from '../../src/main/search'

function unit(dim: number): Float32Array {
  const v = new Float32Array(384)
  v[dim] = 1
  return v
}

function bankWithVector(title: string, vec: Float32Array): string {
  const exp = createExperience({ title, action: title, context: 'work', status: 'confirmed' } as unknown)
  getDb()
    .prepare('INSERT OR REPLACE INTO vec_experiences (experience_id, embedding) VALUES (?, ?)')
    .run(exp.id, vec)
  return exp.id
}

describe('matchBankedStory', () => {
  beforeEach(() => initDb(':memory:'))

  it('returns null when the bank has nothing to match against', async () => {
    const m = await matchBankedStory('a story', async () => unit(0))
    expect(m).toBeNull()
  })

  it('reports ~1.0 similarity for the same-direction embedding (a duplicate story)', async () => {
    const id = bankWithVector('Led the migration', unit(0))
    const m = await matchBankedStory('led the migration', async () => unit(0))
    expect(m?.id).toBe(id)
    expect(m?.similarity).toBeGreaterThan(STORY_MATCH_THRESHOLD)
    expect(m?.similarity).toBeGreaterThan(0.99)
  })

  it('reports low similarity for an orthogonal embedding (an unrelated story)', async () => {
    bankWithVector('Led the migration', unit(0))
    const m = await matchBankedStory('a totally different story', async () => unit(1))
    expect(m?.similarity).toBeLessThan(STORY_MATCH_THRESHOLD)
    expect(m?.similarity).toBeLessThan(0.1)
  })

  it('returns null when the embedding model is unavailable', async () => {
    bankWithVector('Led the migration', unit(0))
    const m = await matchBankedStory('x', async () => {
      throw new Error('model not ready')
    })
    expect(m).toBeNull()
  })
})
