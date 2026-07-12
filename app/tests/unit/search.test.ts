import { describe, it, expect, beforeEach } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { reciprocalRankFusion, searchExperiences } from '../../src/main/search'

describe('reciprocalRankFusion', () => {
  it('ranks an item that tops both lists first', () => {
    const fused = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['a', 'c', 'b']
    ])
    const ranked = [...fused.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id)
    expect(ranked[0]).toBe('a')
  })

  it('a shared top item outscores items appearing in only one list', () => {
    const fused = reciprocalRankFusion([
      ['x', 'y'],
      ['x', 'z']
    ])
    expect(fused.get('x')!).toBeGreaterThan(fused.get('y')!)
    expect(fused.get('x')!).toBeGreaterThan(fused.get('z')!)
  })
})

describe('searchExperiences (FTS path, no embeddings)', () => {
  beforeEach(() => {
    initDb(':memory:')
    createExperience({
      title: 'Led the pipeline rewrite',
      action: 'Rebuilt CI with caching and parallel jobs.',
      context: 'work',
      status: 'confirmed'
    } as unknown)
    createExperience({
      title: 'Mentored two interns',
      action: 'Paired daily and wrote an onboarding guide.',
      context: 'work',
      status: 'draft'
    } as unknown)
  })

  it('ranks a keyword match without a model available', async () => {
    const rows = await searchExperiences({ query: 'onboarding' })
    expect(rows.map((r) => r.title)).toEqual(['Mentored two interns'])
  })

  it('composes structured filters on top of the query', async () => {
    const drafts = await searchExperiences({ query: 'guide', status: 'draft' })
    expect(drafts.map((r) => r.title)).toEqual(['Mentored two interns'])
    const confirmed = await searchExperiences({ query: 'guide', status: 'confirmed' })
    expect(confirmed).toEqual([])
  })

  it('with no query, falls back to the plain filtered list', async () => {
    const rows = await searchExperiences({ context: 'work' })
    expect(rows).toHaveLength(2)
  })
})
