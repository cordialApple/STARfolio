import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import { createSource, findSourceByHash, sha256 } from '../db/repositories/sources'
import { storeAttachment } from './attachments'
import {
  parseDocument,
  parseUrlDocument,
  parseSheetDocument,
  packZipDocument,
  packFolderDocument,
  packRepoDocument
} from './index'
import {
  buildFileSource,
  ingestCodeFolder as ingestCodeFolderCore,
  ingestRepo as ingestRepoCore,
  ingestUrl as ingestUrlCore,
  MAX_INGEST_BYTES,
  type IngestDeps,
  type IngestResult
} from './core'

export type { IngestResult }

const deps: IngestDeps = {
  store: { createSource, findSourceByHash, sha256 },
  parsers: { parseDocument, parseUrlDocument, parseSheetDocument, packZipDocument, packFolderDocument, packRepoDocument }
}

async function ingestOneFile(path: string): Promise<IngestResult> {
  const name = basename(path)
  try {
    if (statSync(path).size > MAX_INGEST_BYTES)
      return { ok: false, name, error: 'That file is too large to import (25 MB max).' }
    const bytes = readFileSync(path)
    const { hash, attachmentPath } = storeAttachment(bytes, name)
    return await buildFileSource(deps, { path, name, bytes, hash, attachmentPath })
  } catch (err) {
    return { ok: false, name, error: (err as Error).message }
  }
}

export async function ingestFiles(paths: string[]): Promise<IngestResult[]> {
  const out: IngestResult[] = []
  for (const p of paths) out.push(await ingestOneFile(p))
  return out
}

export function ingestCodeFolder(path: string): Promise<IngestResult> {
  return ingestCodeFolderCore(deps, path)
}

export function ingestRepo(url: string, token?: string): Promise<IngestResult> {
  return ingestRepoCore(deps, url, token)
}

export function ingestUrl(url: string): Promise<IngestResult> {
  return ingestUrlCore(deps, url)
}
