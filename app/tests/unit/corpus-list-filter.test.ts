import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import { createCorpusDoc, listCorpusDocs } from '../../src/main/db/repositories/corpus'

beforeEach(() => initDb(':memory:'))

describe('listCorpusDocs discipline filter', () => {
  it('returns only docs in the requested discipline', () => {
    const db = getDb()
    createCorpusDoc(db, 'Backend notes', 'backend', null)
    createCorpusDoc(db, 'Frontend notes', 'frontend', null)

    const backend = listCorpusDocs('backend')
    expect(backend.map((d) => d.title)).toEqual(['Backend notes'])
    expect(listCorpusDocs()).toHaveLength(2)
  })
})
