import { randomUUID } from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import {
  deleteExperienceEdges,
  linkExperienceEntities,
  neighborsOf
} from '../../src/main/db/repositories/graph'

const edgeCount = (): number =>
  (getDb().prepare('SELECT COUNT(*) c FROM edges').get() as { c: number }).c

beforeEach(() => initDb(':memory:'))

describe('deleteExperienceEdges', () => {
  it('drops the mentions edges where the experience is the src', () => {
    const a = createExperience({ title: 'A', action: 'a' })
    linkExperienceEntities(a.id, [{ kind: 'tool', name: 'Kafka' }])
    expect(edgeCount()).toBe(1)

    deleteExperienceEdges(getDb(), a.id)

    expect(edgeCount()).toBe(0)
    expect(neighborsOf(a.id).entities).toEqual([])
  })

  it('drops edges where the experience is the dst', () => {
    const a = createExperience({ title: 'A', action: 'a' })
    getDb()
      .prepare(
        `INSERT INTO edges (id, src_kind, src_id, rel, dst_kind, dst_id)
         VALUES (?, 'entity', ?, 'mentions', 'experience', ?)`
      )
      .run(randomUUID(), randomUUID(), a.id)
    expect(edgeCount()).toBe(1)

    deleteExperienceEdges(getDb(), a.id)

    expect(edgeCount()).toBe(0)
  })

  it('leaves other experiences edges untouched', () => {
    const a = createExperience({ title: 'A', action: 'a' })
    const b = createExperience({ title: 'B', action: 'b' })
    linkExperienceEntities(a.id, [{ kind: 'tool', name: 'Redis' }])
    linkExperienceEntities(b.id, [{ kind: 'tool', name: 'Postgres' }])

    deleteExperienceEdges(getDb(), a.id)

    expect(neighborsOf(a.id).entities).toEqual([])
    expect(neighborsOf(b.id).entities.map((e) => e.name)).toEqual(['Postgres'])
  })

  it('is a no-op for an unknown experience id', () => {
    const a = createExperience({ title: 'A', action: 'a' })
    linkExperienceEntities(a.id, [{ kind: 'tool', name: 'Kafka' }])

    expect(() => deleteExperienceEdges(getDb(), 'ghost-id')).not.toThrow()
    expect(edgeCount()).toBe(1)
  })
})
