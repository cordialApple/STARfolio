import { utilityProcess, app, BrowserWindow, type UtilityProcess } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getDb } from '../db/client'

interface ProgressInfo {
  status: string
  file?: string
  progress?: number
  loaded?: number
  total?: number
}
type WorkerMessage =
  | { id: string; ok: boolean; vector?: number[]; error?: string }
  | { type: 'progress'; info: ProgressInfo }

export type ModelPhase = 'idle' | 'downloading' | 'ready' | 'error'
export interface ModelStatus {
  phase: ModelPhase
  progress: number
  error: string | null
}

let child: UtilityProcess | null = null
const pending = new Map<string, { resolve: (v: Float32Array) => void; reject: (e: Error) => void }>()
const status: ModelStatus = { phase: 'idle', progress: 0, error: null }

export function getModelStatus(): ModelStatus {
  return { ...status }
}

function broadcastStatus(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('embed:status', getModelStatus())
  }
}

function onProgress(info: ProgressInfo): void {
  if (status.phase === 'ready') return
  if (info.status === 'progress' && typeof info.progress === 'number') {
    status.phase = 'downloading'
    status.progress = Math.round(info.progress)
    broadcastStatus()
  }
}

function ensureWorker(): UtilityProcess {
  if (child) return child
  const worker = utilityProcess.fork(join(__dirname, 'embed.worker.js'), [], {
    serviceName: 'starfolio-embed'
  })
  worker.on('message', (msg: WorkerMessage) => {
    if ('type' in msg) {
      onProgress(msg.info)
      return
    }
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok && msg.vector) {
      status.phase = 'ready'
      status.progress = 100
      status.error = null
      broadcastStatus()
      p.resolve(Float32Array.from(msg.vector))
    } else {
      p.reject(new Error(msg.error ?? 'embed failed'))
    }
  })
  worker.on('exit', () => {
    child = null
    for (const p of pending.values()) p.reject(new Error('embed worker exited'))
    pending.clear()
  })
  child = worker
  return worker
}

// Deterministic offline vector for e2e/CI — no worker, no model download. Semantically
// meaningless (FTS carries keyword relevance in tests), but stable across write and query.
function stubVector(text: string): Float32Array {
  let h = 2166136261
  const v = new Float32Array(384)
  for (let i = 0; i < 384; i++) {
    h ^= text.charCodeAt(i % text.length) || i
    h = Math.imul(h, 16777619)
    v[i] = ((h >>> 0) % 1000) / 1000 - 0.5
  }
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < 384; i++) v[i] /= norm
  return v
}

export function embed(text: string): Promise<Float32Array> {
  if (process.env.STARFOLIO_EMBED_STUB === '1') {
    status.phase = 'ready'
    return Promise.resolve(stubVector(text))
  }
  const worker = ensureWorker()
  const id = randomUUID()
  const cacheDir = join(app.getPath('userData'), 'models')
  return new Promise<Float32Array>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.postMessage({ type: 'embed', id, text, cacheDir })
  }).catch((err: Error) => {
    status.phase = 'error'
    status.error = err.message
    broadcastStatus()
    throw err
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
