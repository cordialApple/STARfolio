import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'

export interface DocResult {
  text: string
  scanned: boolean
  meta: Record<string, unknown>
}
export interface UrlResult {
  text: string
  title: string | null
  finalUrl: string
  meta: Record<string, unknown>
}
type Reply =
  | { id: string; ok: true; doc?: DocResult; url?: UrlResult }
  | { id: string; ok: false; error: string }

let child: UtilityProcess | null = null
const pending = new Map<string, { resolve: (v: DocResult | UrlResult) => void; reject: (e: Error) => void }>()

function ensureWorker(): UtilityProcess {
  if (child) return child
  const worker = utilityProcess.fork(join(__dirname, 'ingest.worker.js'), [], {
    serviceName: 'starfolio-ingest'
  })
  worker.on('message', (msg: Reply) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok) p.resolve((msg.doc ?? msg.url)!)
    else p.reject(new Error(msg.error))
  })
  worker.on('exit', () => {
    child = null
    for (const p of pending.values()) p.reject(new Error('ingest worker exited'))
    pending.clear()
  })
  child = worker
  return worker
}

function request<T extends DocResult | UrlResult>(
  message: Record<string, unknown>
): Promise<T> {
  const worker = ensureWorker()
  const id = randomUUID()
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: DocResult | UrlResult) => void, reject })
    worker.postMessage({ ...message, id })
  })
}

export function parseDocument(filename: string, bytes: Uint8Array): Promise<DocResult> {
  return request<DocResult>({ type: 'parseDoc', filename, bytes })
}

export function parseUrlDocument(url: string): Promise<UrlResult> {
  return request<UrlResult>({ type: 'parseUrl', url })
}

export function stopIngestWorker(): void {
  child?.kill()
  child = null
}
