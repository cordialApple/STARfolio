import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, getDb } from '../../src/main/db/client'
import {
  createExperience,
  updateExperience,
  deleteExperience,
  getExperience,
  listExperiences,
  listSkills,
  listTags,
  type ExperienceInput
} from '../../src/main/db/repositories/experiences'

function make(over: Partial<ExperienceInput> = {}): ExperienceInput {
  return {
    title: 'Led the pipeline rewrite',
    situation: 'Deploys took forty minutes and blocked the team.',
    task: 'I owned cutting that time down.',
    action: 'Rebuilt the CI pipeline with caching and parallel jobs.',
    result_text: 'Deploys dropped to eight minutes.',
    context: 'work',
    happened_start: '2024-01-01',
    happened_end: '2024-03-01',
    status: 'confirmed',
    skills: [
      { name: 'CI/CD', kind: 'technical' },
      { name: 'Leadership', kind: 'soft' }
    ],
    tags: ['infra'],
    metrics: [{ label: 'deploy time', value: 8, unit: 'min' }],
    ...over
  }
}

beforeEach(() => {
  initDb(':memory:')
})

describe('createExperience', () => {
  it('persists all fields and returns the full record', () => {
    const exp = createExperience(make())
    expect(exp.id).toBeTruthy()
    expect(exp.title).toBe('Led the pipeline rewrite')
    expect(exp.status).toBe('confirmed')
    expect(exp.skills.map((s) => s.name).sort()).toEqual(['CI/CD', 'Leadership'])
    expect(exp.skills.find((s) => s.name === 'Leadership')?.kind).toBe('soft')
    expect(exp.tags.map((t) => t.name)).toEqual(['infra'])
    expect(exp.metrics[0]).toMatchObject({ label: 'deploy time', value: 8, unit: 'min' })
  })

  it('reuses skills and tags by name across experiences (autocomplete-with-create)', () => {
    createExperience(make({ title: 'A' }))
    createExperience(make({ title: 'B', tags: ['infra', 'reliability'] }))
    expect(listSkills().map((s) => s.name).sort()).toEqual(['CI/CD', 'Leadership'])
    expect(listTags().map((t) => t.name).sort()).toEqual(['infra', 'reliability'])
  })

  it('applies zod defaults for a sparse draft', () => {
    const exp = createExperience({ title: 'Rough idea', status: 'draft' } as unknown)
    expect(exp.status).toBe('draft')
    expect(exp.context).toBe('work')
    expect(exp.skills).toEqual([])
    expect(exp.situation).toBe('')
  })
})

describe('listExperiences filters', () => {
  beforeEach(() => {
    createExperience(
      make({ title: 'Work confirmed', context: 'work', status: 'confirmed', tags: ['infra'] })
    )
    createExperience(
      make({
        title: 'Class draft',
        context: 'class',
        status: 'draft',
        skills: [{ name: 'Research', kind: 'domain' }],
        tags: ['school'],
        happened_start: '2022-09-01',
        happened_end: '2022-12-01'
      })
    )
  })

  it('filters by context', () => {
    const rows = listExperiences({ context: 'class' })
    expect(rows.map((r) => r.title)).toEqual(['Class draft'])
  })

  it('filters by status', () => {
    expect(listExperiences({ status: 'draft' }).map((r) => r.title)).toEqual(['Class draft'])
  })

  it('filters by skill name', () => {
    expect(listExperiences({ skill: 'Research' }).map((r) => r.title)).toEqual(['Class draft'])
  })

  it('filters by tag name', () => {
    expect(listExperiences({ tag: 'infra' }).map((r) => r.title)).toEqual(['Work confirmed'])
  })

  it('filters by date range overlap', () => {
    expect(listExperiences({ dateStart: '2024-01-01' }).map((r) => r.title)).toEqual([
      'Work confirmed'
    ])
    expect(listExperiences({ dateEnd: '2023-01-01' }).map((r) => r.title)).toEqual(['Class draft'])
  })

  it('excludes undated rows from date filters but shows them unfiltered', () => {
    createExperience(make({ title: 'No dates', happened_start: null, happened_end: null }))
    expect(listExperiences({}).map((r) => r.title)).toContain('No dates')
    expect(listExperiences({ dateStart: '2000-01-01' }).map((r) => r.title)).not.toContain(
      'No dates'
    )
    expect(listExperiences({ dateEnd: '2100-01-01' }).map((r) => r.title)).not.toContain('No dates')
  })

  it('summaries carry filled-beat flags and chip names', () => {
    const [row] = listExperiences({ context: 'work' })
    expect(row.filled).toEqual({ situation: true, task: true, action: true, result: true })
    expect(row.skills.sort()).toEqual(['CI/CD', 'Leadership'])
  })
})

describe('keyword search', () => {
  beforeEach(() => {
    createExperience(make({ title: 'Led the pipeline rewrite' }))
    createExperience(
      make({
        title: 'Mentored two interns',
        situation: 'Two new interns joined with no onboarding.',
        task: 'Get them shipping.',
        action: 'Paired daily and wrote a starter guide.',
        result_text: 'Both shipped in week one.',
        skills: [],
        tags: [],
        metrics: []
      })
    )
  })

  it('matches a whole word in STAR text', () => {
    expect(listExperiences({ query: 'onboarding' }).map((r) => r.title)).toEqual([
      'Mentored two interns'
    ])
  })

  it('prefix-matches the last token (search-as-you-type)', () => {
    expect(listExperiences({ query: 'pipe' }).map((r) => r.title)).toEqual([
      'Led the pipeline rewrite'
    ])
  })

  it('never throws on FTS operator characters in user input', () => {
    for (const q of ['c++', 'AND OR', '"broken(', 'NEAR*', '   ', '- foo']) {
      expect(() => listExperiences({ query: q })).not.toThrow()
    }
  })
})

describe('updateExperience', () => {
  it('replaces skills/tags/metrics and changes status', () => {
    const created = createExperience(make({ status: 'draft' }))
    const updated = updateExperience(created.id, {
      ...make(),
      status: 'confirmed',
      skills: [{ name: 'CI/CD', kind: 'technical' }],
      tags: ['reliability'],
      metrics: []
    } as unknown)
    expect(updated.status).toBe('confirmed')
    expect(updated.skills.map((s) => s.name)).toEqual(['CI/CD'])
    expect(updated.tags.map((t) => t.name)).toEqual(['reliability'])
    expect(updated.metrics).toEqual([])
    expect(getExperience(created.id)?.tags.map((t) => t.name)).toEqual(['reliability'])
  })

  it('throws for a missing id', () => {
    expect(() => updateExperience('nope', make() as unknown)).toThrow()
  })
})

describe('brain-dump persistence', () => {
  it('attaches a paste source and stores draft_state_json on create', () => {
    const created = createExperience(
      make({
        title: 'From a dump',
        status: 'draft',
        source: { kind: 'paste', raw_text: 'the messy original paragraph' },
        draft_state_json: JSON.stringify({ gaps: [{ field: 'result', question: 'what happened?' }] })
      })
    )
    const got = getExperience(created.id)!
    expect(got.sources).toHaveLength(1)
    expect(got.sources[0]).toMatchObject({ kind: 'paste', raw_text: 'the messy original paragraph' })
    expect(got.draft_state_json).toContain('what happened?')
  })

  it('clears draft_state_json when a draft is confirmed', () => {
    const created = createExperience(
      make({ status: 'draft', draft_state_json: JSON.stringify({ gaps: [] }) })
    )
    const confirmed = updateExperience(created.id, make({ status: 'confirmed' }) as unknown)
    expect(confirmed.draft_state_json).toBeNull()
  })

  it('does not duplicate the source when the experience is later updated', () => {
    const created = createExperience(
      make({ source: { kind: 'paste', raw_text: 'once' } })
    )
    updateExperience(created.id, make({ title: 'edited' }) as unknown)
    expect(getExperience(created.id)!.sources).toHaveLength(1)
  })
})

describe('deleteExperience', () => {
  it('cascades child rows and drops the row from FTS', () => {
    const exp = createExperience(make({ title: 'unique pipeline marker' }))
    expect(listExperiences({ query: 'marker' }).length).toBe(1)

    const res = deleteExperience(exp.id)
    expect(res.deleted).toBe(true)
    expect(getExperience(exp.id)).toBeNull()
    expect(listExperiences({ query: 'marker' }).length).toBe(0)

    const db = getDb()
    const links = db
      .prepare('SELECT count(*) AS n FROM experience_skills WHERE experience_id = ?')
      .get(exp.id) as { n: number }
    expect(links.n).toBe(0)
  })

  it('reports deleted=false for a missing id', () => {
    expect(deleteExperience('nope')).toEqual({ deleted: false })
  })
})
