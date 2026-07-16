import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import { createCorpusDoc, insertChunks } from '../../src/main/db/repositories/corpus'
import { searchCorpus } from '../../src/main/search'

function unit(axis: number): Float32Array {
  const v = new Float32Array(384)
  v[axis] = 1
  return v
}

function embedChunk(id: string, vec: Float32Array): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO vec_corpus (chunk_id, embedding) VALUES (?, ?)')
    .run(id, vec)
}

let backendChunk: string
let frontendChunk: string

beforeEach(() => {
  initDb(':memory:')
  const db = getDb()
  const be = createCorpusDoc(db, 'Backend guide', 'backend', null)
  ;[backendChunk] = insertChunks(db, be, ['kubernetes autoscaling absorbs traffic spikes'])
  const fe = createCorpusDoc(db, 'Frontend guide', 'frontend', null)
  ;[frontendChunk] = insertChunks(db, fe, ['react hooks manage component state'])
  embedChunk(backendChunk, unit(0))
  embedChunk(frontendChunk, unit(1))
})

describe('searchCorpus', () => {
  it('returns nothing for a blank query', async () => {
    expect(await searchCorpus('   ', undefined, 6, async () => unit(0))).toEqual([])
  })

  it('fuses FTS and vector hits across the whole corpus when unscoped', async () => {
    const hits = await searchCorpus('kubernetes', undefined, 6, async () => unit(0))
    const top = hits[0]
    expect(top.chunkId).toBe(backendChunk)
    expect(top.docId).toBeDefined()
    expect(top.title).toBe('Backend guide')
    expect(top.text).toContain('kubernetes')
    expect(top.similarity).toBeCloseTo(1)
  })

  it('scopes vector candidates to a discipline', async () => {
    const hits = await searchCorpus('kubernetes', 'backend', 6, async () => unit(0))
    expect(hits.map((h) => h.chunkId)).toContain(backendChunk)
    expect(hits.map((h) => h.chunkId)).not.toContain(frontendChunk)
  })

  it('falls back to vector-only ranking when the query has no FTS-able tokens', async () => {
    const hits = await searchCorpus('!!!', undefined, 6, async () => unit(0))
    expect(hits[0].chunkId).toBe(backendChunk)
    expect(hits[0].similarity).toBeCloseTo(1)
  })

  it('degrades to keyword-only ranking with zero similarity when the embedder fails', async () => {
    const thrower = async (): Promise<Float32Array> => {
      throw new Error('model offline')
    }
    const hits = await searchCorpus('kubernetes', undefined, 6, thrower)
    expect(hits.map((h) => h.chunkId)).toEqual([backendChunk])
    expect(hits[0].similarity).toBe(0)
  })
})
