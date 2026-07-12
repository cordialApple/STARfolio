import { getDb } from '../db/client'
import { embed } from './index'

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

let draining = false
let retryTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRetry(): void {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    kickCorpusEmbedDrain()
  }, 30_000)
}

export function kickCorpusEmbedDrain(): void {
  if (draining) return
  draining = true
  void (async () => {
    try {
      for (;;) {
        const row = getDb()
          .prepare('SELECT chunk_id FROM corpus_embed_queue ORDER BY enqueued_at LIMIT 1')
          .get() as { chunk_id: string } | undefined
        if (!row) break
        const db = getDb()
        const chunk = db
          .prepare('SELECT text FROM corpus_chunks WHERE id = ?')
          .get(row.chunk_id) as { text: string } | undefined
        if (!chunk) {
          db.prepare('DELETE FROM corpus_embed_queue WHERE chunk_id = ?').run(row.chunk_id)
          continue
        }
        const vector = await embed(chunk.text)
        db.prepare('INSERT OR REPLACE INTO vec_corpus (chunk_id, embedding) VALUES (?, ?)').run(
          row.chunk_id,
          vector
        )
        db.prepare('DELETE FROM corpus_embed_queue WHERE chunk_id = ?').run(row.chunk_id)
      }
    } catch {
      scheduleRetry()
    } finally {
      draining = false
    }
  })()
}
