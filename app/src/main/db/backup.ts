import { copyFileSync } from 'fs'
import { z } from 'zod'
import { getDb, getDbPath } from './client'
import { checkpointDb } from './migrate'
import {
  createExperienceIn,
  experienceInput,
  getExperience,
  type Experience
} from './repositories/experiences'
import {
  insertSource,
  linkSource,
  sourceInput,
  type SourceInput
} from './repositories/sources'

const EXPORT_VERSION = 1

const importExperience = experienceInput
  .omit({ source: true, source_id: true })
  .extend({ sources: z.array(sourceInput).default([]) })

const bankExport = z.object({
  version: z.number().optional(),
  exportedAt: z.string().optional(),
  experiences: z.array(importExperience).default([])
})

export type BankExport = z.infer<typeof bankExport>

function sourceForExport(s: Experience['sources'][number]): SourceInput {
  return {
    kind: s.kind,
    raw_text: s.raw_text ?? '',
    title: s.title,
    uri_or_path: s.uri_or_path,
    attachment_path: s.attachment_path,
    content_hash: null,
    meta: {}
  }
}

export function exportBank(): BankExport {
  const db = getDb()
  const ids = (
    db.prepare('SELECT id FROM experiences ORDER BY created_at').all() as { id: string }[]
  ).map((r) => r.id)

  const experiences = ids.map((id) => {
    const e = getExperience(id)!
    return {
      title: e.title,
      situation: e.situation,
      task: e.task,
      action: e.action,
      result_text: e.result_text,
      context: e.context,
      happened_start: e.happened_start,
      happened_end: e.happened_end,
      status: e.status,
      skills: e.skills.map((s) => ({ name: s.name, kind: s.kind })),
      tags: e.tags.map((t) => t.name),
      metrics: e.metrics.map((m) => ({ label: m.label, value: m.value, unit: m.unit })),
      draft_state_json: e.draft_state_json,
      sources: e.sources.map(sourceForExport)
    }
  })

  return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), experiences }
}

export function importBank(raw: unknown): { imported: number; ids: string[] } {
  const data = bankExport.parse(raw)
  const db = getDb()
  const ids: string[] = []

  db.transaction(() => {
    for (const exp of data.experiences) {
      const { sources, ...fields } = exp
      const id = createExperienceIn(db, experienceInput.parse({ ...fields, source: sources[0] }))
      for (const s of sources.slice(1)) linkSource(db, id, insertSource(db, s))
      ids.push(id)
    }
  })()

  return { imported: ids.length, ids }
}

export function backupTo(destPath: string): { path: string } {
  checkpointDb(getDb())
  copyFileSync(getDbPath(), destPath)
  return { path: destPath }
}
