import { beforeEach, describe, expect, it } from 'vitest'
import { initDb } from '../../src/main/db/client'
import {
  createExperience,
  getExperience,
  listExperiences,
  updateExperience
} from '../../src/main/db/repositories/experiences'

beforeEach(() => initDb(':memory:'))

describe('experiences repo branch coverage', () => {
  it('stores a metric with no value or unit as nulls', () => {
    const e = createExperience({
      title: 'metric only label',
      action: 'a',
      metrics: [{ label: 'headcount' }]
    })
    const metrics = getExperience(e.id)!.metrics
    expect(metrics).toHaveLength(1)
    expect(metrics[0]).toMatchObject({ label: 'headcount', value: null, unit: null })
  })

  it('clears happened dates when an update omits them', () => {
    const e = createExperience({
      title: 'timeline',
      action: 'a',
      happened_start: '2024-01-02',
      happened_end: '2024-03-04'
    })
    const updated = updateExperience(e.id, { title: 'timeline', action: 'a' })
    expect(updated.happened_start).toBeNull()
    expect(updated.happened_end).toBeNull()
  })

  it('yields an empty snippet when every star field is blank', () => {
    const e = createExperience({ title: 'title only' })
    const summary = listExperiences({}).find((s) => s.id === e.id)!
    expect(summary.snippet).toBe('')
  })
})
