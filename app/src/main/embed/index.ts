import { utilityProcess, app, type UtilityProcess } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getDb } from '../db/client'

interface EmbedResponse {
  id: string
  ok: boolean
  vector?: number[]
  error?: string
}

let child: UtilityProcess | null = null
const pending = new Map<string, { resolve: (v: Float32Array) => void; reject: (e: Error) => void }>()

function ensureWorker(): UtilityProcess {
  if (child) return child
  const worker = utilityProcess.fork(join(__dirname, 'embed.worker.js'), [], {
    serviceName: 'starfolio-embed'
  })
  worker.on('message', (msg: EmbedResponse) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok && msg.vector) p.resolve(Float32Array.from(msg.vector))
    else p.reject(new Error(msg.error ?? 'embed failed'))
  })
  worker.on('exit', () => {
    child = null
    for (const p of pending.values()) p.reject(new Error('embed worker exited'))
    pending.clear()
  })
  child = worker
  return worker
}

export function embed(text: string): Promise<Float32Array> {
  const worker = ensureWorker()
  const id = randomUUID()
  const cacheDir = join(app.getPath('userData'), 'models')
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.postMessage({ type: 'embed', id, text, cacheDir })
  })
}

export function stopEmbedWorker(): void {
  child?.kill()
  child = null
}

export async function embedSelfTest(): Promise<{ ok: boolean; dims: number; knn: number }> {
  const vector = await embed('a time I led a project under pressure')
  const db = getDb()
  const id = `embed-selftest-${Date.now()}`
  db.prepare('INSERT INTO experiences (id, title) VALUES (?, ?)').run(id, 'Embed self test')
  db.prepare(
    'INSERT OR REPLACE INTO vec_experiences (experience_id, embedding) VALUES (?, ?)'
  ).run(id, vector)
  const knn = (
    db
      .prepare('SELECT experience_id FROM vec_experiences WHERE embedding MATCH ? AND k = 3')
      .all(vector) as unknown[]
  ).length
  db.prepare('DELETE FROM experiences WHERE id = ?').run(id)
  db.prepare('DELETE FROM vec_experiences WHERE experience_id = ?').run(id)
  return { ok: vector.length === 384 && knn > 0, dims: vector.length, knn }
}
