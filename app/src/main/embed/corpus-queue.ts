import { getDb } from '../db/client'
import { embed } from './index'
import { createEmbedDrainer } from './drain'

export function enqueueCorpusEmbed(chunkId: string): void {
  getDb().prepare('INSERT OR REPLACE INTO corpus_embed_queue (chunk_id) VALUES (?)').run(chunkId)
}

export function backfillCorpusEmbeddings(): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO corpus_embed_queue (chunk_id)
       SELECT id FROM corpus_chunks WHERE id NOT IN (SELECT chunk_id FROM vec_corpus)`
    )
    .run()
}

function corpusChunkText(chunkId: string): string | null {
  const chunk = getDb()
    .prepare('SELECT text FROM corpus_chunks WHERE id = ?')
    .get(chunkId) as { text: string } | undefined
  return chunk ? chunk.text : null
}

const drainer = createEmbedDrainer<string, Float32Array>({
  nextPending: () =>
    (
      getDb()
        .prepare('SELECT chunk_id FROM corpus_embed_queue ORDER BY enqueued_at LIMIT 1')
        .get() as { chunk_id: string } | undefined
    )?.chunk_id,
  resolveText: corpusChunkText,
  embed,
  store: (id, vector) =>
    getDb()
      .prepare('INSERT OR REPLACE INTO vec_corpus (chunk_id, embedding) VALUES (?, ?)')
      .run(id, vector),
  drop: (id) => getDb().prepare('DELETE FROM corpus_embed_queue WHERE chunk_id = ?').run(id)
})

export function kickCorpusEmbedDrain(): void {
  drainer.kick()
}
