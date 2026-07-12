import { getDb } from '../db/client'
import { embed } from './index'

interface PassageRow {
  title: string
  situation: string
  task: string
  action: string
  result_text: string
  skills: string | null
}

// The "experience card" passage that gets embedded: title + STAR + skills, one blob.
export function passageFor(experienceId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT e.title, e.situation, e.task, e.action, e.result_text,
              (SELECT group_concat(s.name, ', ') FROM experience_skills es
                 JOIN skills s ON s.id = es.skill_id WHERE es.experience_id = e.id) AS skills
       FROM experiences e WHERE e.id = ?`
    )
    .get(experienceId) as PassageRow | undefined
  if (!row) return null
  const parts = [row.title, row.situation, row.task, row.action, row.result_text]
  if (row.skills) parts.push(`Skills: ${row.skills}`)
  return parts.filter((p) => p && p.trim()).join('\n')
}

// Pure DB — safe to call from any process, never blocks on the model.
export function enqueueEmbed(experienceId: string): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO embed_queue (experience_id) VALUES (?)')
    .run(experienceId)
}

// Enqueue every experience that has no embedding yet — one-time catch-up for rows
// created before embedding existed, or while the model was unavailable.
export function backfillEmbeddings(): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO embed_queue (experience_id)
       SELECT id FROM experiences
       WHERE id NOT IN (SELECT experience_id FROM vec_experiences)`
    )
    .run()
}

export function pendingEmbedCount(): number {
  return (getDb().prepare('SELECT count(*) AS n FROM embed_queue').get() as { n: number }).n
}

let draining = false
let retryTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRetry(): void {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    kickEmbedDrain()
  }, 30_000)
}

// Drains the queue in the background. A missing/failed model leaves rows queued and
// retries later, so capture never breaks when embeddings are unavailable.
export function kickEmbedDrain(): void {
  if (draining) return
  draining = true
  void (async () => {
    try {
      for (;;) {
        const row = getDb()
          .prepare('SELECT experience_id FROM embed_queue ORDER BY enqueued_at LIMIT 1')
          .get() as { experience_id: string } | undefined
        if (!row) break

        const passage = passageFor(row.experience_id)
        const db = getDb()
        if (passage === null) {
          db.prepare('DELETE FROM embed_queue WHERE experience_id = ?').run(row.experience_id)
          continue
        }
        const vector = await embed(passage)
        db.prepare(
          'INSERT OR REPLACE INTO vec_experiences (experience_id, embedding) VALUES (?, ?)'
        ).run(row.experience_id, vector)
        db.prepare('DELETE FROM embed_queue WHERE experience_id = ?').run(row.experience_id)
      }
    } catch {
      scheduleRetry()
    } finally {
      draining = false
    }
  })()
}
