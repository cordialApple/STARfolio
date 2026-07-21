import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getDb } from '../client'

export const ENTITY_KINDS = ['person', 'team', 'project', 'org', 'tool', 'other'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

export interface EntityInput {
  kind: EntityKind
  name: string
}
export interface EntityNode {
  id: string
  kind: EntityKind
  name: string
}
export interface Connection {
  experience: { id: string; title: string }
  viaEntities: string[]
  viaSkills: string[]
}
export interface Neighbors {
  entities: EntityNode[]
  connections: Connection[]
}

function upsertEntity(db: Database.Database, e: EntityInput): string {
  const name = e.name.trim()
  const existing = db
    .prepare('SELECT id FROM entities WHERE kind = ? AND name = ? COLLATE NOCASE')
    .get(e.kind, name) as { id: string } | undefined
  if (existing) return existing.id
  const id = randomUUID()
  db.prepare('INSERT INTO entities (id, kind, name) VALUES (?, ?, ?)').run(id, e.kind, name)
  return id
}

export function linkExperienceEntities(experienceId: string, entities: EntityInput[]): void {
  if (entities.length === 0) return
  const db = getDb()
  if (!db.prepare('SELECT 1 FROM experiences WHERE id = ?').get(experienceId))
    throw new Error(`experience not found: ${experienceId}`)
  db.transaction(() => {
    for (const e of entities) {
      if (!e.name.trim()) continue
      const entityId = upsertEntity(db, e)
      db.prepare(
        `INSERT OR IGNORE INTO edges (id, src_kind, src_id, rel, dst_kind, dst_id)
         VALUES (?, 'experience', ?, 'mentions', 'entity', ?)`
      ).run(randomUUID(), experienceId, entityId)
    }
  })()
}

export function deleteExperienceEdges(db: Database.Database, experienceId: string): void {
  db.prepare(
    `DELETE FROM edges WHERE (src_kind = 'experience' AND src_id = ?)
        OR (dst_kind = 'experience' AND dst_id = ?)`
  ).run(experienceId, experienceId)
}

export function neighborsOf(experienceId: string): Neighbors {
  const db = getDb()
  const entities = db
    .prepare(
      `SELECT e.id, e.kind, e.name FROM edges g
       JOIN entities e ON e.id = g.dst_id
       WHERE g.src_kind = 'experience' AND g.src_id = ? AND g.dst_kind = 'entity'
       ORDER BY e.name`
    )
    .all(experienceId) as EntityNode[]

  const viaEntity = db
    .prepare(
      `SELECT x.id AS expId, x.title AS title, e.name AS via
       FROM edges g1
       JOIN edges g2 ON g1.dst_id = g2.dst_id AND g2.src_kind = 'experience' AND g2.dst_kind = 'entity'
       JOIN entities e ON e.id = g1.dst_id
       JOIN experiences x ON x.id = g2.src_id
       WHERE g1.src_kind = 'experience' AND g1.src_id = ? AND g1.dst_kind = 'entity'
         AND g2.src_id <> ?`
    )
    .all(experienceId, experienceId) as { expId: string; title: string; via: string }[]

  const viaSkill = db
    .prepare(
      `SELECT x.id AS expId, x.title AS title, s.name AS via
       FROM experience_skills es1
       JOIN experience_skills es2 ON es1.skill_id = es2.skill_id AND es2.experience_id <> es1.experience_id
       JOIN skills s ON s.id = es1.skill_id
       JOIN experiences x ON x.id = es2.experience_id
       WHERE es1.experience_id = ?`
    )
    .all(experienceId) as { expId: string; title: string; via: string }[]

  const byExp = new Map<string, Connection>()
  const add = (row: { expId: string; title: string; via: string }, field: 'viaEntities' | 'viaSkills'): void => {
    let c = byExp.get(row.expId)
    if (!c) {
      c = { experience: { id: row.expId, title: row.title }, viaEntities: [], viaSkills: [] }
      byExp.set(row.expId, c)
    }
    if (!c[field].includes(row.via)) c[field].push(row.via)
  }
  for (const r of viaEntity) add(r, 'viaEntities')
  for (const r of viaSkill) add(r, 'viaSkills')

  return { entities, connections: [...byExp.values()] }
}
