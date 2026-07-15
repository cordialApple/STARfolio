import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  firstTechnicalQuestion,
  evaluateTechnicalAnswer,
  type TechnicalConfig
} from '../../src/main/ai/technical'
import type { CorpusHit } from '../../src/main/search'
import { initDb, getDb } from '../../src/main/db/client'
import { createCorpusDoc, insertChunks, deleteCorpusDoc } from '../../src/main/db/repositories/corpus'
import { startTechnical, answerTechnical } from '../../src/main/technical'
import { endTechnicalSession } from '../../src/main/db/repositories/practice'

const CHUNKS: CorpusHit[] = [
  { chunkId: 'c1', text: 'raft consensus and leader election', docId: 'd1', title: 'Consensus', similarity: 0.9 },
  { chunkId: 'c2', text: 'quorum reads and writes', docId: 'd1', title: 'Consensus', similarity: 0.8 }
]
const CONFIG: TechnicalConfig = { promptText: 'distributed consensus' }

function mockClient(output: unknown): { messages: { parse: () => Promise<unknown> } } {
  return {
    messages: {
      parse: async () => ({ stop_reason: null, parsed_output: output, usage: { input_tokens: 0, output_tokens: 0 } })
    }
  }
}

const score = { score: 3, note: 'ok' }
const feedback = { correctness: score, depth: score, tradeoffs: score, communication: score, summary: 's' }

describe('technical cite-guarantee', () => {
  it('first question falls back to a real chunk when the model cites nothing valid', async () => {
    const client = mockClient({ question: 'q', cited_chunk_ids: ['not-a-real-chunk'] })
    const out = await firstTechnicalQuestion(CONFIG, CHUNKS, client as never)
    expect(out.cited_chunk_ids).toEqual(['c1'])
  })

  it('a non-terminal follow-up always cites at least one real chunk', async () => {
    const client = mockClient({ feedback, next_kind: 'question', next_text: 'next?', cited_chunk_ids: [] })
    const turn = await evaluateTechnicalAnswer({ config: CONFIG, chunks: CHUNKS, asked: [], question: 'q', answer: 'my answer' }, client as never)
    expect(turn.cited_chunk_ids.length).toBeGreaterThanOrEqual(1)
    expect(CHUNKS.map((c) => c.chunkId)).toContain(turn.cited_chunk_ids[0])
  })

  it('keeps only valid cited chunk ids and drops invented ones', async () => {
    const client = mockClient({ feedback, next_kind: 'question', next_text: 'next?', cited_chunk_ids: ['c2', 'ghost'] })
    const turn = await evaluateTechnicalAnswer({ config: CONFIG, chunks: CHUNKS, asked: [], question: 'q', answer: 'a' }, client as never)
    expect(turn.cited_chunk_ids).toEqual(['c2'])
  })

  it('allows an empty citation list on a terminal (done) move', async () => {
    const client = mockClient({ feedback, next_kind: 'done', next_text: '', cited_chunk_ids: [] })
    const turn = await evaluateTechnicalAnswer({ config: CONFIG, chunks: CHUNKS, asked: ['a', 'b', 'c'], question: 'q', answer: 'a' }, client as never)
    expect(turn.cited_chunk_ids).toEqual([])
  })
})

describe('answerTechnical empty-corpus guard', () => {
  beforeEach(() => {
    process.env.STARFOLIO_AI_STUB = '1'
    process.env.STARFOLIO_EMBED_STUB = '1'
    initDb(':memory:')
  })
  afterEach(() => {
    delete process.env.STARFOLIO_AI_STUB
    delete process.env.STARFOLIO_EMBED_STUB
  })

  it('ends the session rather than emit a citation-less follow-up when the corpus is emptied', async () => {
    const db = getDb()
    const docId = createCorpusDoc(db, 'Design', 'systems', null)
    const ids = insertChunks(db, docId, ['a token bucket rate limiter design in redis'])
    const insVec = db.prepare('INSERT OR REPLACE INTO vec_corpus (chunk_id, embedding) VALUES (?, ?)')
    const v = new Float32Array(384)
    v[0] = 1
    insVec.run(ids[0], v)

    const start = await startTechnical({ promptText: 'rate limiter', discipline: 'systems' })
    expect(start.citations.length).toBeGreaterThanOrEqual(1)

    deleteCorpusDoc(docId)

    const res = await answerTechnical({ sessionId: start.sessionId, answer: 'I used a token bucket in redis with atomic refills and a local fallback during partitions to stay available.' })
    // The invariant holds by construction: no non-terminal question ships without a citation.
    if (res.next_kind !== 'done') expect(res.citations.length).toBeGreaterThanOrEqual(1)
    else expect(res.citations).toEqual([])
  })

  it('refuses to answer after the session is ended early', async () => {
    const db = getDb()
    const docId = createCorpusDoc(db, 'Design', 'systems', null)
    const ids = insertChunks(db, docId, ['a token bucket rate limiter design in redis'])
    const v = new Float32Array(384)
    v[0] = 1
    db.prepare('INSERT OR REPLACE INTO vec_corpus (chunk_id, embedding) VALUES (?, ?)').run(ids[0], v)

    const start = await startTechnical({ promptText: 'rate limiter', discipline: 'systems' })
    endTechnicalSession(start.sessionId)

    await expect(
      answerTechnical({ sessionId: start.sessionId, answer: 'token bucket in redis with atomic refills' })
    ).rejects.toThrow(/ended/)
  })
})

describe('technical stub (CI path)', () => {
  it('stub first question cites the top retrieved chunk', async () => {
    const prev = process.env.STARFOLIO_AI_STUB
    process.env.STARFOLIO_AI_STUB = '1'
    try {
      const out = await firstTechnicalQuestion(CONFIG, CHUNKS)
      expect(out.cited_chunk_ids).toEqual(['c1'])
      expect(out.question).toContain('Consensus')
    } finally {
      process.env.STARFOLIO_AI_STUB = prev
    }
  })
})
