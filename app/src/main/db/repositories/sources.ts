import { randomUUID, createHash } from 'crypto'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import { getDb } from '../client'

export const SOURCE_KINDS = ['paste', 'file', 'url', 'repo', 'spreadsheet', 'code'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

const trimmed = (max: number): z.ZodString => z.string().trim().max(max)

export const sourceInput = z.object({
  kind: z.enum(SOURCE_KINDS).default('paste'),
  raw_text: trimmed(2_000_000).default(''),
  title: trimmed(500).nullable().optional(),
  uri_or_path: trimmed(4000).nullable().optional(),
  attachment_path: trimmed(4000).nullable().optional(),
  content_hash: trimmed(128).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional()
})
export type SourceInput = z.infer<typeof sourceInput>

export interface Source {
  id: string
  kind: SourceKind
  title: string | null
  raw_text: string | null
  uri_or_path: string | null
  attachment_path: string | null
  ingested_at: string
}

const SELECT =
  'SELECT id, kind, title, raw_text, uri_or_path, attachment_path, ingested_at FROM sources'

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function insertSource(db: Database.Database, raw: SourceInput): string {
  const s = sourceInput.parse(raw)
  const id = randomUUID()
  db.prepare(
    `INSERT INTO sources (id, kind, uri_or_path, attachment_path, title, raw_text, meta_json, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    s.kind,
    s.uri_or_path ?? null,
    s.attachment_path ?? null,
    s.title ?? null,
    s.raw_text,
    s.meta ? JSON.stringify(s.meta) : null,
    s.content_hash ?? sha256(s.raw_text)
  )
  return id
}

export function linkSource(db: Database.Database, experienceId: string, sourceId: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO experience_sources (experience_id, source_id) VALUES (?, ?)'
  ).run(experienceId, sourceId)
}

export function createSource(raw: unknown): Source {
  const id = insertSource(getDb(), raw as SourceInput)
  return getSource(id)!
}

export function getSource(id: string): Source | null {
  return (getDb().prepare(`${SELECT} WHERE id = ?`).get(id) as Source | undefined) ?? null
}

export function findSourceByHash(hash: string): Source | null {
  return (
    (getDb()
      .prepare(`${SELECT} WHERE content_hash = ? ORDER BY ingested_at LIMIT 1`)
      .get(hash) as Source | undefined) ?? null
  )
}
