import { getDb } from './db/client'
import { extractEntities } from './ai/extract'
import { linkExperienceEntities } from './db/repositories/graph'

interface Row {
  id: string
  title: string
  situation: string
  task: string
  action: string
  result_text: string
}

let running = false

export async function backfillEntities(limit = 100): Promise<{ processed: number }> {
  if (running) return { processed: 0 }
  running = true
  try {
    return await runBackfill(limit)
  } finally {
    running = false
  }
}

async function runBackfill(limit: number): Promise<{ processed: number }> {
  const rows = getDb()
    .prepare(
      `SELECT id, title, situation, task, action, result_text FROM experiences x
       WHERE NOT EXISTS (
         SELECT 1 FROM edges e
         WHERE e.src_kind = 'experience' AND e.src_id = x.id AND e.rel = 'mentions'
       )
       LIMIT ?`
    )
    .all(limit) as Row[]

  let processed = 0
  for (const r of rows) {
    const text = [r.title, r.situation, r.task, r.action, r.result_text].filter(Boolean).join('\n')
    if (!text.trim()) continue
    const { entities } = await extractEntities(text)
    linkExperienceEntities(r.id, entities)
    processed++
  }
  return { processed }
}
