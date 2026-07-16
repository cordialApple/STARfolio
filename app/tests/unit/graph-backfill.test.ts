import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { neighborsOf } from '../../src/main/db/repositories/graph'
import { backfillEntities } from '../../src/main/graph-backfill'

describe('backfillEntities', () => {
  beforeEach(() => {
    vi.stubEnv('STARFOLIO_AI_STUB', '1')
    initDb(':memory:')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('extracts entities for experiences with no mentions edges and links them', async () => {
    const exp = createExperience({ title: 'migration', action: 'used Kafka heavily' })
    expect(await backfillEntities()).toEqual({ processed: 1 })

    const names = neighborsOf(exp.id).entities.map((e) => e.name)
    expect(names).toContain('Kafka')
    expect(neighborsOf(exp.id).entities.every((e) => e.kind === 'tool')).toBe(true)
  })

  it('cross-links two experiences that mention the same entity', async () => {
    const a = createExperience({ title: 'one', action: 'used Kafka heavily' })
    const b = createExperience({ title: 'two', action: 'also chose Kafka' })
    await backfillEntities()

    const conn = neighborsOf(a.id).connections.find((c) => c.experience.id === b.id)
    expect(conn?.viaEntities).toContain('Kafka')
  })

  it('is idempotent: a second pass has nothing left to process', async () => {
    createExperience({ title: 'x', action: 'used Kafka heavily' })
    expect(await backfillEntities()).toEqual({ processed: 1 })
    expect(await backfillEntities()).toEqual({ processed: 0 })
  })

  it('honors the limit and leaves the rest for a later pass', async () => {
    createExperience({ title: 'a', action: 'used Kafka heavily' })
    createExperience({ title: 'b', action: 'chose Redis instead' })
    expect(await backfillEntities(1)).toEqual({ processed: 1 })
    expect(await backfillEntities(1)).toEqual({ processed: 1 })
    expect(await backfillEntities(1)).toEqual({ processed: 0 })
  })

  it('skips experiences with no STAR text', async () => {
    createExperience({ title: '', action: '' })
    expect(await backfillEntities()).toEqual({ processed: 0 })
  })
})
