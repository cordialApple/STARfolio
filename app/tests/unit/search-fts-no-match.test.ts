import { beforeEach, describe, expect, it } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { searchExperiences } from '../../src/main/search'

function unit(axis: number): Float32Array {
  const v = new Float32Array(384)
  v[axis] = 1
  return v
}

describe('searchExperiences with no FTS-able query tokens', () => {
  beforeEach(() => initDb(':memory:'))

  it('skips the FTS candidate query when the text has no word tokens', async () => {
    createExperience({ title: 'Banked story', action: 'a' })

    const rows = await searchExperiences({ query: '!!!' }, async () => unit(0))

    expect(rows).toEqual([])
  })
})
