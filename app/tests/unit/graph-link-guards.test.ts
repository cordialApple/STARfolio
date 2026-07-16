import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { linkExperienceEntities, neighborsOf } from '../../src/main/db/repositories/graph'

const edgeCount = (): number =>
  (getDb().prepare('SELECT COUNT(*) c FROM edges').get() as { c: number }).c

beforeEach(() => initDb(':memory:'))

describe('linkExperienceEntities guards', () => {
  it('is a no-op for an empty entity list', () => {
    const a = createExperience({ title: 'A', action: 'a' })
    linkExperienceEntities(a.id, [])
    expect(edgeCount()).toBe(0)
    expect(neighborsOf(a.id).entities).toEqual([])
  })

  it('throws when the experience does not exist', () => {
    expect(() => linkExperienceEntities('ghost-id', [{ kind: 'tool', name: 'Kafka' }])).toThrow(
      'experience not found: ghost-id'
    )
    expect(edgeCount()).toBe(0)
  })

  it('skips blank-named entities and links the rest', () => {
    const a = createExperience({ title: 'A', action: 'a' })
    linkExperienceEntities(a.id, [
      { kind: 'tool', name: '   ' },
      { kind: 'tool', name: 'Kafka' }
    ])
    expect(neighborsOf(a.id).entities.map((e) => e.name)).toEqual(['Kafka'])
    expect(edgeCount()).toBe(1)
  })
})
