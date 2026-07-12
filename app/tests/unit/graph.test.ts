import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, getDb } from '../../src/main/db/client'
import { createExperience, deleteExperience } from '../../src/main/db/repositories/experiences'
import { linkExperienceEntities, neighborsOf } from '../../src/main/db/repositories/graph'

describe('knowledge graph', () => {
  beforeEach(() => initDb(':memory:'))

  it('connects two experiences that share an entity', () => {
    const a = createExperience({ title: 'Built the API', action: 'a' })
    const b = createExperience({ title: 'Scaled the API', action: 'b' })
    linkExperienceEntities(a.id, [{ kind: 'tool', name: 'Postgres' }, { kind: 'project', name: 'Billing' }])
    linkExperienceEntities(b.id, [{ kind: 'tool', name: 'Postgres' }])

    const n = neighborsOf(a.id)
    expect(n.entities.map((e) => e.name).sort()).toEqual(['Billing', 'Postgres'])
    expect(n.connections).toHaveLength(1)
    expect(n.connections[0].experience.id).toBe(b.id)
    expect(n.connections[0].viaEntities).toEqual(['Postgres'])
  })

  it('deduplicates entities by (kind, name) across experiences', () => {
    const a = createExperience({ title: 'A', action: 'a' })
    const b = createExperience({ title: 'B', action: 'b' })
    linkExperienceEntities(a.id, [{ kind: 'tool', name: 'Redis' }])
    linkExperienceEntities(b.id, [{ kind: 'tool', name: 'Redis' }])
    const count = (getDb().prepare("SELECT COUNT(*) c FROM entities WHERE name='Redis'").get() as { c: number }).c
    expect(count).toBe(1)
  })

  it('connects via a shared skill even with no shared entity', () => {
    const a = createExperience({ title: 'Frontend work', action: 'a', skills: [{ name: 'React', kind: 'technical' }] })
    const b = createExperience({ title: 'More frontend', action: 'b', skills: [{ name: 'React', kind: 'technical' }] })
    const n = neighborsOf(a.id)
    const conn = n.connections.find((c) => c.experience.id === b.id)
    expect(conn?.viaSkills).toEqual(['React'])
  })

  it('drops an experience edges when the experience is deleted', () => {
    const a = createExperience({ title: 'A', action: 'a' })
    linkExperienceEntities(a.id, [{ kind: 'tool', name: 'Kafka' }])
    expect((getDb().prepare('SELECT COUNT(*) c FROM edges').get() as { c: number }).c).toBe(1)
    deleteExperience(a.id)
    expect((getDb().prepare('SELECT COUNT(*) c FROM edges').get() as { c: number }).c).toBe(0)
  })
})
