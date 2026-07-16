import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { matchBankedStory } from '../../src/main/search'

function unit(axis: number): Float32Array {
  const v = new Float32Array(384)
  v[axis] = 1
  return v
}

function insertEmbedding(id: string, vec: Float32Array): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO vec_experiences (experience_id, embedding) VALUES (?, ?)')
    .run(id, vec)
}

describe('matchBankedStory', () => {
  beforeEach(() => initDb(':memory:'))

  it('returns the nearest banked experience with a cosine similarity', async () => {
    const exp = createExperience({ title: 'Shipped the migration', action: 'a' })
    insertEmbedding(exp.id, unit(0))

    const match = await matchBankedStory('any spoken answer', async () => unit(0))

    expect(match).toEqual({ id: exp.id, title: 'Shipped the migration', similarity: 1 })
  })

  it('returns null for blank text', async () => {
    expect(await matchBankedStory('   ', async () => unit(0))).toBeNull()
  })

  it('returns null when the embedder is unavailable', async () => {
    const thrower = async (): Promise<Float32Array> => {
      throw new Error('model offline')
    }
    expect(await matchBankedStory('text', thrower)).toBeNull()
  })

  it('returns null when nothing is banked to compare against', async () => {
    expect(await matchBankedStory('text', async () => unit(0))).toBeNull()
  })
})
