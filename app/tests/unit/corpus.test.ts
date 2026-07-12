import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, getDb } from '../../src/main/db/client'
import {
  chunkText,
  createCorpusDoc,
  insertChunks,
  listCorpusDocs,
  getChunks,
  deleteCorpusDoc,
  corpusDisciplines
} from '../../src/main/db/repositories/corpus'
import { searchCorpus } from '../../src/main/search'

function unit(dim: number): Float32Array {
  const v = new Float32Array(384)
  v[dim] = 1
  return v
}

function seedDoc(title: string, discipline: string | null, chunks: { text: string; vec: Float32Array }[]): string {
  const db = getDb()
  const docId = createCorpusDoc(db, title, discipline, null)
  const ids = insertChunks(db, docId, chunks.map((c) => c.text))
  const insVec = db.prepare('INSERT OR REPLACE INTO vec_corpus (chunk_id, embedding) VALUES (?, ?)')
  ids.forEach((id, i) => insVec.run(id, chunks[i].vec))
  return docId
}

describe('chunkText', () => {
  it('splits on paragraph boundaries and hard-splits huge paragraphs', () => {
    expect(chunkText('')).toEqual([])
    const small = chunkText('one\n\ntwo\n\nthree')
    expect(small.join(' ')).toContain('one')
    const huge = 'x'.repeat(4000)
    const parts = chunkText(huge, 1200)
    expect(parts.length).toBeGreaterThan(2)
    expect(parts.every((p) => p.length <= 1200)).toBe(true)
  })
})

describe('corpus repository', () => {
  beforeEach(() => initDb(':memory:'))

  it('creates docs and chunks, lists with counts, and gets chunks in order', () => {
    const docId = seedDoc('Rate limiter', 'distributed systems', [
      { text: 'token bucket algorithm', vec: unit(0) },
      { text: 'sliding window log', vec: unit(1) }
    ])
    const docs = listCorpusDocs()
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ title: 'Rate limiter', discipline: 'distributed systems', chunks: 2 })
    expect(corpusDisciplines()).toEqual(['distributed systems'])

    const chunkId = getDb().prepare('SELECT id FROM corpus_chunks WHERE doc_id = ? ORDER BY seq LIMIT 1').get(docId) as { id: string }
    const got = getChunks([chunkId.id])
    expect(got[0].text).toBe('token bucket algorithm')
    expect(got[0].title).toBe('Rate limiter')
  })

  it('deletes a doc and cascades its chunks + vectors', () => {
    const docId = seedDoc('Doc', null, [{ text: 'alpha', vec: unit(0) }])
    expect((getDb().prepare('SELECT count(*) c FROM vec_corpus').get() as { c: number }).c).toBe(1)
    deleteCorpusDoc(docId)
    expect((getDb().prepare('SELECT count(*) c FROM corpus_chunks').get() as { c: number }).c).toBe(0)
    expect((getDb().prepare('SELECT count(*) c FROM vec_corpus').get() as { c: number }).c).toBe(0)
  })
})

describe('searchCorpus', () => {
  beforeEach(() => initDb(':memory:'))

  it('ranks the vector-and-keyword match on top', async () => {
    seedDoc('Networking', null, [
      { text: 'consensus via raft leader election', vec: unit(0) },
      { text: 'unrelated content about kitchens', vec: unit(5) }
    ])
    const hits = await searchCorpus('raft consensus', undefined, 5, async () => unit(0))
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].text).toContain('raft')
    expect(hits[0].similarity).toBeGreaterThan(0.9)
  })

  it('scopes results to a discipline', async () => {
    seedDoc('Backend notes', 'backend', [{ text: 'sharding a database', vec: unit(0) }])
    seedDoc('Frontend notes', 'frontend', [{ text: 'sharding a database', vec: unit(0) }])
    const hits = await searchCorpus('sharding', 'backend', 5, async () => unit(0))
    expect(hits.length).toBe(1)
    expect(hits[0].title).toBe('Backend notes')
  })
})
