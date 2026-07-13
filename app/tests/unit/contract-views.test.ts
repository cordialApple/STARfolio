import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, getDb } from '../../src/main/db/client'

const EXPECTED: Record<string, string[]> = {
  v_experiences: [
    'id', 'title', 'situation', 'task', 'action', 'result_text',
    'context', 'status', 'happened_start', 'happened_end', 'created_at', 'updated_at'
  ],
  v_experience_skills: ['experience_id', 'skill_name', 'skill_kind'],
  v_experience_tags: ['experience_id', 'tag_name'],
  v_experience_metrics: ['experience_id', 'label', 'value', 'unit'],
  v_entities: ['id', 'kind', 'name'],
  v_edges: ['src_kind', 'src_id', 'rel', 'dst_kind', 'dst_id'],
  v_experience_sources: ['experience_id', 'source_kind', 'uri_or_path', 'title']
}

describe('contract views (migration 007)', () => {
  beforeEach(() => initDb(':memory:'))

  it('exposes every pledged view with exactly its contract columns', () => {
    const db = getDb()
    for (const [view, columns] of Object.entries(EXPECTED)) {
      const names = db.prepare(`SELECT * FROM ${view} LIMIT 0`).columns().map((c) => c.name)
      expect(names, view).toEqual(columns)
    }
  })
})
