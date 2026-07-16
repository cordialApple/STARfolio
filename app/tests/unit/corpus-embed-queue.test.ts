import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import { createCorpusDoc, insertChunks } from '../../src/main/db/repositories/corpus'
import { backfillCorpusEmbeddings, enqueueCorpusEmbed } from '../../src/main/embed/corpus-queue'

function seedChunks(texts: string[]): string[] {
  const db = getDb()
  const docId = createCorpusDoc(db, 'doc', 'backend', null)
  return insertChunks(db, docId, texts)
}

function queued(): string[] {
  return (getDb().prepare('SELECT chunk_id FROM corpus_embed_queue').all() as { chunk_id: string }[])
    .map((r) => r.chunk_id)
}

beforeEach(() => {
  initDb(':memory:')
})

describe('enqueueCorpusEmbed', () => {
  it('is idempotent per chunk', () => {
    const [id] = seedChunks(['alpha'])
    enqueueCorpusEmbed(id)
    enqueueCorpusEmbed(id)
    expect(queued()).toEqual([id])
  })

  it('drops queued rows when the chunk is deleted', () => {
    const [id] = seedChunks(['alpha'])
    enqueueCorpusEmbed(id)
    getDb().prepare('DELETE FROM corpus_chunks WHERE id = ?').run(id)
    expect(queued()).toEqual([])
  })
})

describe('backfillCorpusEmbeddings', () => {
  it('enqueues only chunks without an embedding', () => {
    const [a, b] = seedChunks(['alpha', 'beta'])
    getDb()
      .prepare('INSERT INTO vec_corpus (chunk_id, embedding) VALUES (?, ?)')
      .run(a, new Float32Array(384).fill(0.1))

    backfillCorpusEmbeddings()
    expect(queued()).toEqual([b])
  })

  it('does not duplicate an already-queued chunk', () => {
    const [a] = seedChunks(['alpha'])
    enqueueCorpusEmbed(a)
    backfillCorpusEmbeddings()
    expect(queued()).toEqual([a])
  })
})
