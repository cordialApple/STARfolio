import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import { getDb } from '../db/client'
import { createSource, type Source } from '../db/repositories/sources'
import { chunkText, createCorpusDoc, insertChunks } from '../db/repositories/corpus'
import { enqueueCorpusEmbed, kickCorpusEmbedDrain } from '../embed/corpus-queue'
import { parseDocument, parseUrlDocument } from './index'

const MAX_IMPORT_BYTES = 25_000_000

export interface CorpusIngestResult {
  ok: boolean
  name: string
  error?: string
  docId?: string
  chunks?: number
}

function persist(title: string, discipline: string | null, source: Source, text: string): CorpusIngestResult {
  const chunks = chunkText(text)
  if (chunks.length === 0) return { ok: false, name: title, error: 'No readable text to add to the corpus.' }
  const db = getDb()
  let docId = ''
  let ids: string[] = []
  db.transaction(() => {
    docId = createCorpusDoc(db, title, discipline, source.id)
    ids = insertChunks(db, docId, chunks)
  })()
  for (const id of ids) enqueueCorpusEmbed(id)
  kickCorpusEmbedDrain()
  return { ok: true, name: title, docId, chunks: chunks.length }
}

const clean = (discipline: string): string | null => discipline.trim() || null

async function ingestOneFile(path: string, discipline: string): Promise<CorpusIngestResult> {
  const name = basename(path)
  try {
    if (statSync(path).size > MAX_IMPORT_BYTES)
      return { ok: false, name, error: 'That file is too large to add (25 MB max).' }
    const bytes = readFileSync(path)
    const { text, scanned } = await parseDocument(name, bytes)
    if (scanned) return { ok: false, name, error: 'This PDF looks scanned — there is no text layer to read.' }
    if (!text.trim()) return { ok: false, name, error: 'No readable text found in this file.' }
    const source = createSource({ kind: 'file', uri_or_path: path, title: name, raw_text: text })
    return persist(name, clean(discipline), source, text)
  } catch (err) {
    return { ok: false, name, error: (err as Error).message }
  }
}

export async function ingestCorpusFiles(paths: string[], discipline: string): Promise<CorpusIngestResult[]> {
  const out: CorpusIngestResult[] = []
  for (const p of paths) out.push(await ingestOneFile(p, discipline))
  return out
}

export async function ingestCorpusUrl(url: string, discipline: string): Promise<CorpusIngestResult> {
  try {
    const { text, title, finalUrl } = await parseUrlDocument(url)
    if (!text.trim()) return { ok: false, name: url, error: 'No readable article found on that page.' }
    const source = createSource({ kind: 'url', uri_or_path: finalUrl, title, raw_text: text })
    return persist(title ?? url, clean(discipline), source, text)
  } catch (err) {
    return { ok: false, name: url, error: (err as Error).message }
  }
}
