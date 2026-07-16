import { beforeEach, describe, expect, it } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { linkExperienceEntities, neighborsOf } from '../../src/main/db/repositories/graph'

beforeEach(() => initDb(':memory:'))

describe('neighborsOf deduplicates a repeated via name', () => {
  it('lists a shared name once when two same-named entities of different kinds connect the pair', () => {
    const a = createExperience({ title: 'Infra A', action: 'a' })
    const b = createExperience({ title: 'Infra B', action: 'b' })
    const both = [
      { kind: 'tool' as const, name: 'AWS' },
      { kind: 'org' as const, name: 'AWS' }
    ]
    linkExperienceEntities(a.id, both)
    linkExperienceEntities(b.id, both)

    const conns = neighborsOf(a.id).connections
    expect(conns).toHaveLength(1)
    expect(conns[0].experience.id).toBe(b.id)
    expect(conns[0].viaEntities).toEqual(['AWS'])
  })
})
