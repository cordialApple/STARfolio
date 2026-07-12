import { randomUUID } from 'crypto'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import { getDb } from '../client'
import { sourceInput, insertSource, linkSource, type Source } from './sources'
import { deleteExperienceEdges } from './graph'

export const CONTEXTS = ['work', 'project', 'class', 'other'] as const
export const STATUSES = ['draft', 'confirmed'] as const
export const SKILL_KINDS = ['technical', 'soft', 'domain'] as const

const trimmed = (max: number): z.ZodString => z.string().trim().max(max)
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .nullable()
  .optional()

export const skillInput = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(SKILL_KINDS).default('technical')
})

export const metricInput = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.number().finite().nullable().optional(),
  unit: trimmed(40).nullable().optional()
})

export const experienceInput = z.object({
  title: trimmed(200).default(''),
  situation: trimmed(20_000).default(''),
  task: trimmed(20_000).default(''),
  action: trimmed(20_000).default(''),
  result_text: trimmed(20_000).default(''),
  context: z.enum(CONTEXTS).default('work'),
  happened_start: isoDate,
  happened_end: isoDate,
  status: z.enum(STATUSES).default('draft'),
  skills: z.array(skillInput).max(50).default([]),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  metrics: z.array(metricInput).max(50).default([]),
  draft_state_json: trimmed(50_000).nullable().optional(),
  source: sourceInput.optional(),
  source_id: trimmed(64).optional()
})

export const listFilter = z
  .object({
    query: trimmed(200).optional(),
    context: z.enum(CONTEXTS).optional(),
    status: z.enum(STATUSES).optional(),
    skill: trimmed(80).optional(),
    tag: trimmed(80).optional(),
    dateStart: isoDate,
    dateEnd: isoDate
  })
  .default({})

export type ExperienceInput = z.infer<typeof experienceInput>
export type ListFilter = z.infer<typeof listFilter>

export interface Skill {
  id: string
  name: string
  kind: (typeof SKILL_KINDS)[number]
}
export interface Tag {
  id: string
  name: string
}
export interface Metric {
  id: string
  label: string
  value: number | null
  unit: string | null
}
export type { Source }
export interface Experience {
  id: string
  title: string
  situation: string
  task: string
  action: string
  result_text: string
  context: (typeof CONTEXTS)[number]
  happened_start: string | null
  happened_end: string | null
  status: (typeof STATUSES)[number]
  draft_state_json: string | null
  created_at: string
  updated_at: string
  skills: Skill[]
  tags: Tag[]
  metrics: Metric[]
  sources: Source[]
}
export interface ExperienceSummary {
  id: string
  title: string
  context: (typeof CONTEXTS)[number]
  status: (typeof STATUSES)[number]
  happened_start: string | null
  happened_end: string | null
  updated_at: string
  filled: { situation: boolean; task: boolean; action: boolean; result: boolean }
  snippet: string
  skills: string[]
  tags: string[]
}

const SEP = String.fromCharCode(31)
const splitNames = (v: string | null): string[] => (v ? v.split(SEP) : [])

// FTS5 treats bare words like AND/OR/NEAR and chars like "*():- as operators; unquoted
// user input throws "fts5: syntax error". Reduce to alnum tokens, quote each (neutralising
// keywords), and make the final token a prefix so search-as-you-type matches.
export function toFtsMatchQuery(raw: string): string | null {
  const tokens = raw.match(/[\p{L}\p{N}]+/gu)
  if (!tokens || tokens.length === 0) return null
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ')
}

function upsertSkill(db: Database.Database, s: z.infer<typeof skillInput>): string {
  const existing = db.prepare('SELECT id FROM skills WHERE name = ?').get(s.name) as
    | { id: string }
    | undefined
  if (existing) return existing.id
  const id = randomUUID()
  db.prepare('INSERT INTO skills (id, name, kind) VALUES (?, ?, ?)').run(id, s.name, s.kind)
  return id
}

function upsertTag(db: Database.Database, name: string): string {
  const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as
    | { id: string }
    | undefined
  if (existing) return existing.id
  const id = randomUUID()
  db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, name)
  return id
}

function writeChildren(db: Database.Database, id: string, input: ExperienceInput): void {
  db.prepare('DELETE FROM experience_skills WHERE experience_id = ?').run(id)
  db.prepare('DELETE FROM experience_tags WHERE experience_id = ?').run(id)
  db.prepare('DELETE FROM metrics WHERE experience_id = ?').run(id)

  const linkSkill = db.prepare(
    'INSERT OR IGNORE INTO experience_skills (experience_id, skill_id) VALUES (?, ?)'
  )
  for (const s of input.skills) linkSkill.run(id, upsertSkill(db, s))

  const linkTag = db.prepare(
    'INSERT OR IGNORE INTO experience_tags (experience_id, tag_id) VALUES (?, ?)'
  )
  for (const name of input.tags) linkTag.run(id, upsertTag(db, name))

  const insMetric = db.prepare(
    'INSERT INTO metrics (id, experience_id, label, value, unit) VALUES (?, ?, ?, ?, ?)'
  )
  for (const m of input.metrics)
    insMetric.run(randomUUID(), id, m.label, m.value ?? null, m.unit ?? null)
}

export function createExperience(raw: unknown): Experience {
  const input = experienceInput.parse(raw)
  const db = getDb()
  const id = randomUUID()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO experiences
       (id, title, situation, task, action, result_text, context, happened_start, happened_end, status, draft_state_json)
       VALUES (@id, @title, @situation, @task, @action, @result_text, @context, @happened_start, @happened_end, @status, @draft_state_json)`
    ).run({
      id,
      title: input.title,
      situation: input.situation,
      task: input.task,
      action: input.action,
      result_text: input.result_text,
      context: input.context,
      happened_start: input.happened_start ?? null,
      happened_end: input.happened_end ?? null,
      status: input.status,
      draft_state_json: input.draft_state_json ?? null
    })
    writeChildren(db, id, input)
    if (input.source_id) linkSource(db, id, input.source_id)
    else if (input.source) linkSource(db, id, insertSource(db, input.source))
  })()
  return getExperience(id)!
}

export function updateExperience(id: string, raw: unknown): Experience {
  const input = experienceInput.parse(raw)
  const db = getDb()
  const found = db.prepare('SELECT 1 FROM experiences WHERE id = ?').get(id)
  if (!found) throw new Error(`experience not found: ${id}`)
  db.transaction(() => {
    db.prepare(
      `UPDATE experiences SET
         title=@title, situation=@situation, task=@task, action=@action, result_text=@result_text,
         context=@context, happened_start=@happened_start, happened_end=@happened_end,
         status=@status, draft_state_json=@draft_state_json, updated_at=datetime('now')
       WHERE id=@id`
    ).run({
      id,
      title: input.title,
      situation: input.situation,
      task: input.task,
      action: input.action,
      result_text: input.result_text,
      context: input.context,
      happened_start: input.happened_start ?? null,
      happened_end: input.happened_end ?? null,
      status: input.status,
      draft_state_json: input.draft_state_json ?? null
    })
    writeChildren(db, id, input)
  })()
  return getExperience(id)!
}

export function deleteExperience(id: string): { deleted: boolean } {
  const db = getDb()
  // vec_experiences is a virtual table with no FK cascade, so drop its row explicitly —
  // in one transaction so a crash can't orphan an embedding from its experience.
  let changes = 0
  db.transaction(() => {
    db.prepare('DELETE FROM vec_experiences WHERE experience_id = ?').run(id)
    deleteExperienceEdges(db, id)
    changes = db.prepare('DELETE FROM experiences WHERE id = ?').run(id).changes
  })()
  return { deleted: changes > 0 }
}

export function getExperience(id: string): Experience | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, title, situation, task, action, result_text, context,
              happened_start, happened_end, status, draft_state_json, created_at, updated_at
       FROM experiences WHERE id = ?`
    )
    .get(id) as Omit<Experience, 'skills' | 'tags' | 'metrics' | 'sources'> | undefined
  if (!row) return null

  const skills = db
    .prepare(
      `SELECT s.id, s.name, s.kind FROM experience_skills es
       JOIN skills s ON s.id = es.skill_id WHERE es.experience_id = ? ORDER BY s.name`
    )
    .all(id) as Skill[]
  const tags = db
    .prepare(
      `SELECT t.id, t.name FROM experience_tags et
       JOIN tags t ON t.id = et.tag_id WHERE et.experience_id = ? ORDER BY t.name`
    )
    .all(id) as Tag[]
  const metrics = db
    .prepare('SELECT id, label, value, unit FROM metrics WHERE experience_id = ? ORDER BY rowid')
    .all(id) as Metric[]
  const sources = db
    .prepare(
      `SELECT s.id, s.kind, s.title, s.raw_text, s.uri_or_path, s.attachment_path, s.ingested_at FROM experience_sources es
       JOIN sources s ON s.id = es.source_id WHERE es.experience_id = ? ORDER BY s.ingested_at`
    )
    .all(id) as Source[]

  return { ...row, skills, tags, metrics, sources }
}

const firstNonEmpty = (r: {
  situation: string
  task: string
  action: string
  result_text: string
}): string => r.situation || r.task || r.action || r.result_text || ''

export function listExperiences(raw: unknown): ExperienceSummary[] {
  const filter = listFilter.parse(raw)
  const db = getDb()
  const match = filter.query ? toFtsMatchQuery(filter.query) : null

  const where: string[] = []
  const params: Record<string, string> = {}
  const joinFts = match !== null

  if (match) {
    where.push('experiences_fts MATCH @match')
    params.match = match
  }
  if (filter.context) {
    where.push('e.context = @context')
    params.context = filter.context
  }
  if (filter.status) {
    where.push('e.status = @status')
    params.status = filter.status
  }
  if (filter.skill) {
    where.push(
      `EXISTS (SELECT 1 FROM experience_skills es JOIN skills s ON s.id = es.skill_id
               WHERE es.experience_id = e.id AND s.name = @skill)`
    )
    params.skill = filter.skill
  }
  if (filter.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM experience_tags et JOIN tags t ON t.id = et.tag_id
               WHERE et.experience_id = e.id AND t.name = @tag)`
    )
    params.tag = filter.tag
  }
  if (filter.dateStart) {
    where.push('COALESCE(e.happened_end, e.happened_start) >= @dateStart')
    params.dateStart = filter.dateStart
  }
  if (filter.dateEnd) {
    where.push('COALESCE(e.happened_start, e.happened_end) <= @dateEnd')
    params.dateEnd = filter.dateEnd
  }

  const sql = `
    SELECT e.id, e.title, e.context, e.status, e.happened_start, e.happened_end, e.updated_at,
           e.situation, e.task, e.action, e.result_text,
           (SELECT group_concat(s.name, char(31)) FROM experience_skills es
              JOIN skills s ON s.id = es.skill_id WHERE es.experience_id = e.id) AS skill_names,
           (SELECT group_concat(t.name, char(31)) FROM experience_tags et
              JOIN tags t ON t.id = et.tag_id WHERE et.experience_id = e.id) AS tag_names
    FROM experiences e
    ${joinFts ? 'JOIN experiences_fts ON experiences_fts.rowid = e.rowid' : ''}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${joinFts ? 'rank' : 'e.updated_at DESC'}
    LIMIT 500`

  const rows = db.prepare(sql).all(params) as (Omit<
    ExperienceSummary,
    'skills' | 'tags' | 'filled' | 'snippet'
  > & {
    situation: string
    task: string
    action: string
    result_text: string
    skill_names: string | null
    tag_names: string | null
  })[]

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    context: r.context,
    status: r.status,
    happened_start: r.happened_start,
    happened_end: r.happened_end,
    updated_at: r.updated_at,
    filled: {
      situation: r.situation.length > 0,
      task: r.task.length > 0,
      action: r.action.length > 0,
      result: r.result_text.length > 0
    },
    snippet: firstNonEmpty(r).slice(0, 240),
    skills: splitNames(r.skill_names),
    tags: splitNames(r.tag_names)
  }))
}

export function listSkills(): Skill[] {
  return getDb().prepare('SELECT id, name, kind FROM skills ORDER BY name').all() as Skill[]
}

export function listTags(): Tag[] {
  return getDb().prepare('SELECT id, name FROM tags ORDER BY name').all() as Tag[]
}
