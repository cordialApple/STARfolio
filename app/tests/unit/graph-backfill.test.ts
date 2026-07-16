import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import { createExperience, type ExperienceInput } from '../../src/main/db/repositories/experiences'
import { neighborsOf } from '../../src/main/db/repositories/graph'
import { backfillEntities } from '../../src/main/graph-backfill'

function make(over: Partial<ExperienceInput> = {}): ExperienceInput {
  return {
    title: 'Kafka migration',
    situation: 'the pipeline was slow',
    task: 'reduce latency',
    action: 'adopted Redpanda for throughput',
    result_text: 'cut cost',
    context: 'work',
    happened_start: null,
    happened_end: null,
    status: 'confirmed',
    skills: [],
    tags: [],
    metrics: [],
    ...over
  }
}

function mentionsCount(experienceId: string): number {
  return (
    getDb()
      .prepare(
        `SELECT count(*) AS n FROM edges
           WHERE src_kind = 'experience' AND src_id = ? AND rel = 'mentions'`
      )
      .get(experienceId) as { n: number }
  ).n
}

beforeEach(() => {
  vi.stubEnv('STARFOLIO_AI_STUB', '1')
  initDb(':memory:')
})

afterEach(() => {
  try {
    getDb().close()
  } catch {
    // already closed
  }
  vi.unstubAllEnvs()
})

describe('backfillEntities', () => {
  it('links entities extracted from unlinked experiences', async () => {
    const exp = createExperience(make())
    const res = await backfillEntities()
    expect(res.processed).toBe(1)

    const names = neighborsOf(exp.id).entities.map((e) => e.name)
    expect(names).toContain('Kafka')
    expect(names).toContain('Redpanda')
    expect(mentionsCount(exp.id)).toBeGreaterThan(0)
  })

  it('is idempotent: a second run skips already-linked experiences', async () => {
    createExperience(make())
    expect((await backfillEntities()).processed).toBe(1)
    expect((await backfillEntities()).processed).toBe(0)
  })

  it('honors the limit and drains the remainder on later runs', async () => {
    createExperience(make({ title: 'Kafka one' }))
    createExperience(make({ title: 'Kafka two' }))
    createExperience(make({ title: 'Kafka three' }))

    expect((await backfillEntities(2)).processed).toBe(2)
    expect((await backfillEntities(100)).processed).toBe(1)
    expect((await backfillEntities(100)).processed).toBe(0)
  })

  it('skips experiences whose STAR fields are all blank', async () => {
    const blank = createExperience({
      title: '',
      situation: '',
      task: '',
      action: '',
      result_text: ''
    } as unknown)
    createExperience(make())

    expect((await backfillEntities()).processed).toBe(1)
    expect(mentionsCount(blank.id)).toBe(0)
  })

  it('re-entrancy guard returns processed 0 for an overlapping call', async () => {
    createExperience(make())
    const [a, b] = await Promise.all([backfillEntities(), backfillEntities()])
    const processed = [a.processed, b.processed].sort()
    expect(processed).toEqual([0, 1])
  })

  it('returns processed 0 on an empty store', async () => {
    expect((await backfillEntities()).processed).toBe(0)
  })
})
