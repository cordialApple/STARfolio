import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { searchExperiences } from '../../src/main/search'

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

describe('searchExperiences vector KNN path', () => {
  beforeEach(() => initDb(':memory:'))

  it('ranks by vector nearest-neighbour when the query text has no FTS match', async () => {
    const near = createExperience({ title: 'Near story', action: 'a' })
    const far = createExperience({ title: 'Far story', action: 'b' })
    insertEmbedding(near.id, unit(0))
    insertEmbedding(far.id, unit(1))

    const rows = await searchExperiences({ query: 'zzznomatch' }, async () => unit(0))

    expect(rows.map((r) => r.id)).toEqual([near.id, far.id])
  })
})
