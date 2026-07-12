import { readFileSync } from 'fs'
import { basename } from 'path'
import { createSource, findSourceByHash, sha256, type Source } from '../db/repositories/sources'
import { storeAttachment } from './attachments'
import { parseDocument, parseUrlDocument } from './index'

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
    const bytes = readFileSync(path)
    const { hash, attachmentPath } = storeAttachment(bytes, name)
    const existing = findSourceByHash(hash)
    if (existing) return { ok: true, name, duplicate: true, source: existing }

    const { text, scanned, meta } = await parseDocument(name, bytes)
    if (scanned)
      return { ok: false, name, scanned: true, error: 'This PDF looks scanned — there is no text layer to read.' }
    if (!text.trim()) return { ok: false, name, error: 'No readable text found in this file.' }

    const source = createSource({
      kind: 'file',
      uri_or_path: path,
      attachment_path: attachmentPath,
      title: name,
      raw_text: text,
      content_hash: hash,
      meta
    })
    return { ok: true, name, source }
  } catch (err) {
    return { ok: false, name, error: (err as Error).message }
  }
}

export async function ingestFiles(paths: string[]): Promise<IngestResult[]> {
  const out: IngestResult[] = []
  for (const p of paths) out.push(await ingestOneFile(p))
  return out
}

export async function ingestUrl(url: string): Promise<IngestResult> {
  try {
    const { text, title, finalUrl, meta } = await parseUrlDocument(url)
    if (!text.trim()) return { ok: false, name: url, error: 'No readable article found on that page.' }
    const hash = sha256(`${finalUrl}\n${text}`)
    const existing = findSourceByHash(hash)
    if (existing) return { ok: true, name: url, duplicate: true, source: existing }
    const source = createSource({
      kind: 'url',
      uri_or_path: finalUrl,
      title,
      raw_text: text,
      content_hash: hash,
      meta
    })
    return { ok: true, name: url, source }
  } catch (err) {
    return { ok: false, name: url, error: (err as Error).message }
  }
}
