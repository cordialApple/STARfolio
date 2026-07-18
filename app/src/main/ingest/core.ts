import { basename, extname } from 'path'
import type { Source } from '../db/repositories/sources'
import type { DocResult, UrlResult, PackDoc } from './index'

export const MAX_INGEST_BYTES = 25_000_000
const SHEET_EXT = new Set(['.xlsx', '.csv'])

export interface SourceStore {
  createSource: (input: unknown) => Source
  findSourceByHash: (hash: string) => Source | null
  sha256: (text: string) => string
}

export interface IngestParsers {
  parseDocument: (filename: string, bytes: Uint8Array) => Promise<DocResult>
  parseUrlDocument: (url: string) => Promise<UrlResult>
  parseSheetDocument: (filename: string, bytes: Uint8Array) => Promise<PackDoc>
  packZipDocument: (filename: string, bytes: Uint8Array) => Promise<PackDoc>
  packFolderDocument: (path: string) => Promise<PackDoc>
  packRepoDocument: (url: string, token?: string) => Promise<PackDoc>
}

export interface IngestDeps {
  store: SourceStore
  parsers: IngestParsers
}

export interface IngestResult {
  ok: boolean
  name: string
  error?: string
  scanned?: boolean
  duplicate?: boolean
  source?: Source
}

interface FileInput {
  path: string
  name: string
  bytes: Uint8Array
  hash: string
  attachmentPath: string
}

export async function buildFileSource(deps: IngestDeps, file: FileInput): Promise<IngestResult> {
  const { path, name, bytes, hash, attachmentPath } = file
  const existing = deps.store.findSourceByHash(hash)
  if (existing) return { ok: true, name, duplicate: true, source: existing }

  const make = (kind: string, text: string, meta: unknown): IngestResult => ({
    ok: true,
    name,
    source: deps.store.createSource({ kind, uri_or_path: path, attachment_path: attachmentPath, title: name, raw_text: text, content_hash: hash, meta })
  })

  const ext = extname(name).toLowerCase()
  if (SHEET_EXT.has(ext)) {
    const { text, meta } = await deps.parsers.parseSheetDocument(name, bytes)
    return make('spreadsheet', text, meta)
  }
  if (ext === '.zip') {
    const { text, meta } = await deps.parsers.packZipDocument(name, bytes)
    return make('code', text, meta)
  }

  const { text, scanned, meta } = await deps.parsers.parseDocument(name, bytes)
  if (scanned)
    return { ok: false, name, scanned: true, error: 'This PDF looks scanned — there is no text layer to read.' }
  if (!text.trim()) return { ok: false, name, error: 'No readable text found in this file.' }
  return make('file', text, meta)
}

export async function ingestCodeFolder(deps: IngestDeps, path: string): Promise<IngestResult> {
  const name = basename(path)
  try {
    const { text, meta } = await deps.parsers.packFolderDocument(path)
    const hash = deps.store.sha256(text)
    const existing = deps.store.findSourceByHash(hash)
    if (existing) return { ok: true, name, duplicate: true, source: existing }
    return {
      ok: true,
      name,
      source: deps.store.createSource({ kind: 'code', uri_or_path: path, title: name, raw_text: text, content_hash: hash, meta })
    }
  } catch (err) {
    return { ok: false, name, error: (err as Error).message }
  }
}

export async function ingestRepo(deps: IngestDeps, url: string, token?: string): Promise<IngestResult> {
  try {
    const { text, title, meta } = await deps.parsers.packRepoDocument(url, token)
    const name = title ?? url
    const hash = deps.store.sha256(text)
    const existing = deps.store.findSourceByHash(hash)
    if (existing) return { ok: true, name, duplicate: true, source: existing }
    return {
      ok: true,
      name,
      source: deps.store.createSource({ kind: 'repo', uri_or_path: url, title: name, raw_text: text, content_hash: hash, meta })
    }
  } catch (err) {
    return { ok: false, name: url, error: (err as Error).message }
  }
}

export async function ingestUrl(deps: IngestDeps, url: string): Promise<IngestResult> {
  try {
    const { text, title, finalUrl, meta } = await deps.parsers.parseUrlDocument(url)
    if (!text.trim()) return { ok: false, name: url, error: 'No readable article found on that page.' }
    const hash = deps.store.sha256(`${finalUrl}\n${text}`)
    const existing = deps.store.findSourceByHash(hash)
    if (existing) return { ok: true, name: url, duplicate: true, source: existing }
    return {
      ok: true,
      name: url,
      source: deps.store.createSource({ kind: 'url', uri_or_path: finalUrl, title, raw_text: text, content_hash: hash, meta })
    }
  } catch (err) {
    return { ok: false, name: url, error: (err as Error).message }
  }
}

export function replyPayload(msg: { doc?: DocResult; url?: UrlResult; pack?: PackDoc }): DocResult | UrlResult | PackDoc {
  const payload = msg.doc ?? msg.url ?? msg.pack
  if (!payload) throw new Error('ingest worker returned an empty reply')
  return payload
}
