import { beforeEach, describe, expect, it } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { linkExperienceEntities, neighborsOf } from '../../src/main/db/repositories/graph'

beforeEach(() => initDb(':memory:'))

describe('neighborsOf combined connection', () => {
  it('folds a shared entity and a shared skill into one connection', () => {
    const a = createExperience({ title: 'Payments A', action: 'a', skills: [{ name: 'React', kind: 'technical' }] })
    const b = createExperience({ title: 'Payments B', action: 'b', skills: [{ name: 'React', kind: 'technical' }] })
    linkExperienceEntities(a.id, [{ kind: 'tool', name: 'Stripe' }])
    linkExperienceEntities(b.id, [{ kind: 'tool', name: 'Stripe' }])

    const conns = neighborsOf(a.id).connections
    expect(conns).toHaveLength(1)
    expect(conns[0].experience.id).toBe(b.id)
    expect(conns[0].viaEntities).toEqual(['Stripe'])
    expect(conns[0].viaSkills).toEqual(['React'])
  })
})
