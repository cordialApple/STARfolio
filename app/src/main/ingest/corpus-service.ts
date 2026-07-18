import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import { getDb } from '../db/client'
import { createSource } from '../db/repositories/sources'
import { chunkText, createCorpusDoc, insertChunks } from '../db/repositories/corpus'
import { enqueueCorpusEmbed, kickCorpusEmbedDrain } from '../embed/corpus-queue'
import { parseDocument, parseUrlDocument } from './index'
import {
  ingestCorpusFile,
  ingestCorpusUrl as ingestCorpusUrlCore,
  MAX_CORPUS_BYTES,
  type CorpusDeps,
  type CorpusIngestResult
} from './corpus-core'

export type { CorpusIngestResult }

const deps: CorpusDeps = {
  store: {
    createSource,
    chunkText,
    persistDoc: (title, discipline, sourceId, chunks) => {
      const db = getDb()
      let docId = ''
      let chunkIds: string[] = []
      db.transaction(() => {
        docId = createCorpusDoc(db, title, discipline, sourceId)
        chunkIds = insertChunks(db, docId, chunks)
      })()
      return { docId, chunkIds }
    },
    enqueueEmbed: enqueueCorpusEmbed,
    kickDrain: kickCorpusEmbedDrain
  },
  parsers: { parseDocument, parseUrlDocument }
}

async function ingestOneFile(path: string, discipline: string): Promise<CorpusIngestResult> {
  const name = basename(path)
  try {
    if (statSync(path).size > MAX_CORPUS_BYTES)
      return { ok: false, name, error: 'That file is too large to add (25 MB max).' }
    const bytes = readFileSync(path)
    return await ingestCorpusFile(deps, { path, name, bytes }, discipline)
  } catch (err) {
    return { ok: false, name, error: (err as Error).message }
  }
}

export async function ingestCorpusFiles(paths: string[], discipline: string): Promise<CorpusIngestResult[]> {
  const out: CorpusIngestResult[] = []
  for (const p of paths) out.push(await ingestOneFile(p, discipline))
  return out
}

export function ingestCorpusUrl(url: string, discipline: string): Promise<CorpusIngestResult> {
  return ingestCorpusUrlCore(deps, url, discipline)
}
