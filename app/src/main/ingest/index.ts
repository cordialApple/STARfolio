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
export interface PackDoc {
  text: string
  title: string | null
  meta: Record<string, unknown>
}
type IngestReply = DocResult | UrlResult | PackDoc
type Reply =
  | { id: string; ok: true; doc?: DocResult; url?: UrlResult; pack?: PackDoc }
  | { id: string; ok: false; error: string }

const REQUEST_TIMEOUT_MS = 60_000

let child: UtilityProcess | null = null
const pending = new Map<
  string,
  { resolve: (v: IngestReply) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>()

function settle(id: string): { resolve: (v: IngestReply) => void; reject: (e: Error) => void } | undefined {
  const p = pending.get(id)
  if (!p) return undefined
  clearTimeout(p.timer)
  pending.delete(id)
  return p
}

function ensureWorker(): UtilityProcess {
  if (child) return child
  const worker = utilityProcess.fork(join(__dirname, 'ingest.worker.js'), [], {
    serviceName: 'starfolio-ingest'
  })
  worker.on('message', (msg: Reply) => {
    const p = settle(msg.id)
    if (!p) return
    if (msg.ok) p.resolve((msg.doc ?? msg.url ?? msg.pack)!)
    else p.reject(new Error(msg.error))
  })
  worker.on('exit', () => {
    child = null
    for (const p of pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('ingest worker exited'))
    }
    pending.clear()
  })
  child = worker
  return worker
}

function request<T extends IngestReply>(message: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const worker = ensureWorker()
  const id = randomUUID()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('That input took too long to read and was skipped.'))
    }, timeoutMs)
    pending.set(id, { resolve: resolve as (v: IngestReply) => void, reject, timer })
    worker.postMessage({ ...message, id })
  })
}

export function parseDocument(filename: string, bytes: Uint8Array): Promise<DocResult> {
  return request<DocResult>({ type: 'parseDoc', filename, bytes })
}

export function parseUrlDocument(url: string): Promise<UrlResult> {
  return request<UrlResult>({ type: 'parseUrl', url })
}

export function parseSheetDocument(filename: string, bytes: Uint8Array): Promise<PackDoc> {
  return request<PackDoc>({ type: 'parseSheet', filename, bytes })
}

export function packFolderDocument(path: string): Promise<PackDoc> {
  return request<PackDoc>({ type: 'packFolder', path }, 180_000)
}

export function packZipDocument(filename: string, bytes: Uint8Array): Promise<PackDoc> {
  return request<PackDoc>({ type: 'packZip', filename, bytes }, 180_000)
}

export function packRepoDocument(url: string, token?: string): Promise<PackDoc> {
  return request<PackDoc>({ type: 'packRepo', url, token }, 180_000)
}

export function stopIngestWorker(): void {
  child?.kill()
  child = null
}
