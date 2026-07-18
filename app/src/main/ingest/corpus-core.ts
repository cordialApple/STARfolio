import type { Source } from '../db/repositories/sources'
import type { DocResult, UrlResult } from './index'

export const MAX_CORPUS_BYTES = 25_000_000

export interface CorpusStore {
  createSource: (input: unknown) => Source
  chunkText: (text: string) => string[]
  persistDoc: (
    title: string,
    discipline: string | null,
    sourceId: string | null,
    chunks: string[]
  ) => { docId: string; chunkIds: string[] }
  enqueueEmbed: (chunkId: string) => void
  kickDrain: () => void
}

export interface CorpusParsers {
  parseDocument: (filename: string, bytes: Uint8Array) => Promise<DocResult>
  parseUrlDocument: (url: string) => Promise<UrlResult>
}

export interface CorpusDeps {
  store: CorpusStore
  parsers: CorpusParsers
}

export interface CorpusIngestResult {
  ok: boolean
  name: string
  error?: string
  docId?: string
  chunks?: number
}

const clean = (discipline: string): string | null => discipline.trim() || null

function persist(deps: CorpusDeps, title: string, discipline: string | null, source: Source, text: string): CorpusIngestResult {
  const chunks = deps.store.chunkText(text)
  if (chunks.length === 0) return { ok: false, name: title, error: 'No readable text to add to the corpus.' }
  const { docId, chunkIds } = deps.store.persistDoc(title, discipline, source.id, chunks)
  for (const id of chunkIds) deps.store.enqueueEmbed(id)
  deps.store.kickDrain()
  return { ok: true, name: title, docId, chunks: chunks.length }
}

export async function ingestCorpusFile(
  deps: CorpusDeps,
  file: { path: string; name: string; bytes: Uint8Array },
  discipline: string
): Promise<CorpusIngestResult> {
  const { path, name, bytes } = file
  const { text, scanned } = await deps.parsers.parseDocument(name, bytes)
  if (scanned) return { ok: false, name, error: 'This PDF looks scanned — there is no text layer to read.' }
  if (!text.trim()) return { ok: false, name, error: 'No readable text found in this file.' }
  const source = deps.store.createSource({ kind: 'file', uri_or_path: path, title: name, raw_text: text })
  return persist(deps, name, clean(discipline), source, text)
}

export async function ingestCorpusUrl(deps: CorpusDeps, url: string, discipline: string): Promise<CorpusIngestResult> {
  try {
    const { text, title, finalUrl } = await deps.parsers.parseUrlDocument(url)
    if (!text.trim()) return { ok: false, name: url, error: 'No readable article found on that page.' }
    const source = deps.store.createSource({ kind: 'url', uri_or_path: finalUrl, title, raw_text: text })
    return persist(deps, title ?? url, clean(discipline), source, text)
  } catch (err) {
    return { ok: false, name: url, error: (err as Error).message }
  }
}
