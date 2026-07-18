import { describe, expect, it } from 'vitest'
import { buildListQuery } from '../../src/main/db/repositories/experiences-query'

const norm = (sql: string): string => sql.replace(/\s+/g, ' ').trim()

describe('buildListQuery', () => {
  it('has no WHERE, no FTS join, and orders by updated_at with an empty filter', () => {
    const { sql, params } = buildListQuery({})
    const s = norm(sql)
    expect(s).toContain('FROM experiences e ORDER BY e.updated_at DESC')
    expect(s).not.toContain('experiences_fts')
    expect(s).toContain('LIMIT 500')
    expect(params).toEqual({})
  })

  it('gates on FTS, joins the fts table, and orders by rank when a query is given', () => {
    const { sql, params } = buildListQuery({ query: 'cache invalidation' })
    const s = norm(sql)
    expect(s).toContain('JOIN experiences_fts ON experiences_fts.rowid = e.rowid')
    expect(s).toContain('experiences_fts MATCH @match')
    expect(s).toContain('ORDER BY rank')
    expect(s).not.toContain('e.updated_at DESC')
    expect(params.match).toBe('"cache" "invalidation"*')
  })

  it('drops the FTS branch when the query reduces to no tokens', () => {
    const { sql, params } = buildListQuery({ query: '!!! ***' })
    const s = norm(sql)
    expect(s).not.toContain('experiences_fts')
    expect(s).toContain('FROM experiences e ORDER BY e.updated_at DESC')
    expect(params.match).toBeUndefined()
  })

  it('adds context and status equality predicates', () => {
    const { sql, params } = buildListQuery({ context: 'work', status: 'confirmed' })
    const s = norm(sql)
    expect(s).toContain('WHERE e.context = @context AND e.status = @status')
    expect(params).toEqual({ context: 'work', status: 'confirmed' })
  })

  it('emits EXISTS subqueries for skill and tag filters', () => {
    const { sql, params } = buildListQuery({ skill: 'redis', tag: 'backend' })
    const s = norm(sql)
    expect(s).toContain('AND s.name = @skill')
    expect(s).toContain('AND t.name = @tag')
    expect(params).toEqual({ skill: 'redis', tag: 'backend' })
  })

  it('uses COALESCE with the correct column order for date bounds', () => {
    const { sql, params } = buildListQuery({ dateStart: '2024-01-01', dateEnd: '2024-12-31' })
    const s = norm(sql)
    expect(s).toContain('COALESCE(e.happened_end, e.happened_start) >= @dateStart')
    expect(s).toContain('COALESCE(e.happened_start, e.happened_end) <= @dateEnd')
    expect(params).toEqual({ dateStart: '2024-01-01', dateEnd: '2024-12-31' })
  })

  it('ANDs every predicate together when all filters are present', () => {
    const { sql, params } = buildListQuery({
      query: 'redis',
      context: 'work',
      status: 'draft',
      skill: 'sql',
      tag: 'db',
      dateStart: '2024-01-01',
      dateEnd: '2024-12-31'
    })
    const s = norm(sql)
    expect(s).toContain('experiences_fts MATCH @match AND e.context = @context AND e.status = @status')
    expect(s).toContain('ORDER BY rank')
    expect(Object.keys(params).sort()).toEqual(
      ['context', 'dateEnd', 'dateStart', 'match', 'skill', 'status', 'tag'].sort()
    )
  })
})
