import { readFileSync, statSync } from 'fs'
import { basename, extname } from 'path'
import { createSource, findSourceByHash, sha256, type Source } from '../db/repositories/sources'
import { storeAttachment } from './attachments'
import {
  parseDocument,
  parseUrlDocument,
  parseSheetDocument,
  packZipDocument,
  packFolderDocument,
  packRepoDocument
} from './index'

const MAX_IMPORT_BYTES = 25_000_000
const SHEET_EXT = new Set(['.xlsx', '.csv'])

export interface IngestResult {
  ok: boolean
  name: string
  error?: string
  scanned?: boolean
  duplicate?: boolean
  source?: Source
}

async function ingestOneFile(path: string): Promise<IngestResult> {
  const name = basename(path)
  try {
    if (statSync(path).size > MAX_IMPORT_BYTES)
      return { ok: false, name, error: 'That file is too large to import (25 MB max).' }
    const bytes = readFileSync(path)
    const { hash, attachmentPath } = storeAttachment(bytes, name)
    const existing = findSourceByHash(hash)
    if (existing) return { ok: true, name, duplicate: true, source: existing }
    const ext = extname(name).toLowerCase()

    if (SHEET_EXT.has(ext)) {
      const { text, meta } = await parseSheetDocument(name, bytes)
      return {
        ok: true,
        name,
        source: createSource({ kind: 'spreadsheet', uri_or_path: path, attachment_path: attachmentPath, title: name, raw_text: text, content_hash: hash, meta })
      }
    }
    if (ext === '.zip') {
      const { text, meta } = await packZipDocument(name, bytes)
      return {
        ok: true,
        name,
        source: createSource({ kind: 'code', uri_or_path: path, attachment_path: attachmentPath, title: name, raw_text: text, content_hash: hash, meta })
      }
    }

    const { text, scanned, meta } = await parseDocument(name, bytes)
    if (scanned)
      return { ok: false, name, scanned: true, error: 'This PDF looks scanned — there is no text layer to read.' }
    if (!text.trim()) return { ok: false, name, error: 'No readable text found in this file.' }
    return {
      ok: true,
      name,
      source: createSource({ kind: 'file', uri_or_path: path, attachment_path: attachmentPath, title: name, raw_text: text, content_hash: hash, meta })
    }
  } catch (err) {
    return { ok: false, name, error: (err as Error).message }
  }
}

export async function ingestFiles(paths: string[]): Promise<IngestResult[]> {
  const out: IngestResult[] = []
  for (const p of paths) out.push(await ingestOneFile(p))
  return out
}

export async function ingestCodeFolder(path: string): Promise<IngestResult> {
  const name = basename(path)
  try {
    const { text, meta } = await packFolderDocument(path)
    const hash = sha256(text)
    const existing = findSourceByHash(hash)
    if (existing) return { ok: true, name, duplicate: true, source: existing }
    return {
      ok: true,
      name,
      source: createSource({ kind: 'code', uri_or_path: path, title: name, raw_text: text, content_hash: hash, meta })
    }
  } catch (err) {
    return { ok: false, name, error: (err as Error).message }
  }
}

export async function ingestRepo(url: string, token?: string): Promise<IngestResult> {
  try {
    const { text, title, meta } = await packRepoDocument(url, token)
    const name = title ?? url
    const hash = sha256(text)
    const existing = findSourceByHash(hash)
    if (existing) return { ok: true, name, duplicate: true, source: existing }
    return {
      ok: true,
      name,
      source: createSource({ kind: 'repo', uri_or_path: url, title: name, raw_text: text, content_hash: hash, meta })
    }
  } catch (err) {
    return { ok: false, name: url, error: (err as Error).message }
  }
}

export async function ingestUrl(url: string): Promise<IngestResult> {
  try {
    const { text, title, finalUrl, meta } = await parseUrlDocument(url)
    if (!text.trim()) return { ok: false, name: url, error: 'No readable article found on that page.' }
    const hash = sha256(`${finalUrl}\n${text}`)
    const existing = findSourceByHash(hash)
    if (existing) return { ok: true, name: url, duplicate: true, source: existing }
    return {
      ok: true,
      name: url,
      source: createSource({ kind: 'url', uri_or_path: finalUrl, title, raw_text: text, content_hash: hash, meta })
    }
  } catch (err) {
    return { ok: false, name: url, error: (err as Error).message }
  }
}
