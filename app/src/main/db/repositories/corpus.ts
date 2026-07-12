import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDb } from '../client'

export interface CorpusDocSummary {
  id: string
  title: string
  discipline: string | null
  chunks: number
}
export interface CorpusChunk {
  id: string
  text: string
  doc_id: string
  title: string
}

const TARGET_CHARS = 1200

// Split into ~TARGET_CHARS chunks on paragraph boundaries, hard-splitting any single
// paragraph that dwarfs the target so one giant block can't become one unsearchable chunk.
export function chunkText(text: string, target = TARGET_CHARS): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  const chunks: string[] = []
  let cur = ''
  const flush = (): void => {
    if (cur.trim()) chunks.push(cur.trim())
    cur = ''
  }
  for (const raw of clean.split(/\n\s*\n/)) {
    const para = raw.trim()
    if (!para) continue
    if (para.length > target * 1.5) {
      flush()
      for (let i = 0; i < para.length; i += target) chunks.push(para.slice(i, i + target))
      continue
    }
    if (cur && cur.length + para.length + 2 > target) flush()
    cur = cur ? `${cur}\n\n${para}` : para
  }
  flush()
  return chunks
}

export function createCorpusDoc(
  db: Database.Database,
  title: string,
  discipline: string | null,
  sourceId: string | null
): string {
  const id = randomUUID()
  db.prepare('INSERT INTO corpus_docs (id, title, discipline, source_id) VALUES (?, ?, ?, ?)').run(
    id,
    title,
    discipline,
    sourceId
  )
  return id
}

export function insertChunks(db: Database.Database, docId: string, chunks: string[]): string[] {
  const ins = db.prepare('INSERT INTO corpus_chunks (id, doc_id, seq, text) VALUES (?, ?, ?, ?)')
  const ids: string[] = []
  chunks.forEach((text, seq) => {
    const id = randomUUID()
    ins.run(id, docId, seq, text)
    ids.push(id)
  })
  return ids
}

export function listCorpusDocs(discipline?: string): CorpusDocSummary[] {
  const where = discipline ? 'WHERE d.discipline = ?' : ''
  const args = discipline ? [discipline] : []
  return getDb()
    .prepare(
      `SELECT d.id, d.title, d.discipline,
              (SELECT count(*) FROM corpus_chunks c WHERE c.doc_id = d.id) AS chunks
       FROM corpus_docs d ${where} ORDER BY d.rowid DESC`
    )
    .all(...args) as CorpusDocSummary[]
}

export function corpusDisciplines(): string[] {
  return (
    getDb()
      .prepare(
        "SELECT DISTINCT discipline FROM corpus_docs WHERE discipline IS NOT NULL AND discipline <> '' ORDER BY discipline"
      )
      .all() as { discipline: string }[]
  ).map((r) => r.discipline)
}

export function deleteCorpusDoc(id: string): { deleted: boolean } {
  const db = getDb()
  let changes = 0
  db.transaction(() => {
    // vec_corpus is a virtual table with no FK cascade, so drop its rows explicitly before
    // the chunks they key off are cascaded away by the corpus_docs delete.
    db.prepare(
      'DELETE FROM vec_corpus WHERE chunk_id IN (SELECT id FROM corpus_chunks WHERE doc_id = ?)'
    ).run(id)
    changes = db.prepare('DELETE FROM corpus_docs WHERE id = ?').run(id).changes
  })()
  return { deleted: changes > 0 }
}

export function getChunks(ids: string[]): CorpusChunk[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.text, c.doc_id, d.title FROM corpus_chunks c
       JOIN corpus_docs d ON d.id = c.doc_id WHERE c.id IN (${placeholders})`
    )
    .all(...ids) as CorpusChunk[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((c): c is CorpusChunk => c !== undefined)
}
