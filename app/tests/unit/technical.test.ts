import { describe, it, expect } from 'vitest'
import {
  firstTechnicalQuestion,
  evaluateTechnicalAnswer,
  type TechnicalConfig
} from '../../src/main/ai/technical'
import type { CorpusHit } from '../../src/main/search'

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
