export interface ListQueryFilter {
  query?: string
  context?: string
  status?: string
  skill?: string
  tag?: string
  dateStart?: string | null
  dateEnd?: string | null
}

// FTS5 treats bare words like AND/OR/NEAR and chars like "*():- as operators; unquoted
// user input throws "fts5: syntax error". Reduce to alnum tokens, quote each (neutralising
// keywords), and make the final token a prefix so search-as-you-type matches.
export function toFtsMatchQuery(raw: string): string | null {
  const tokens = raw.match(/[\p{L}\p{N}]+/gu)
  if (!tokens || tokens.length === 0) return null
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ')
}

export function buildListQuery(filter: ListQueryFilter): {
  sql: string
  params: Record<string, string>
} {
  const match = filter.query ? toFtsMatchQuery(filter.query) : null
  const where: string[] = []
  const params: Record<string, string> = {}
  const joinFts = match !== null

  if (match) {
    where.push('experiences_fts MATCH @match')
    params.match = match
  }
  if (filter.context) {
    where.push('e.context = @context')
    params.context = filter.context
  }
  if (filter.status) {
    where.push('e.status = @status')
    params.status = filter.status
  }
  if (filter.skill) {
    where.push(
      `EXISTS (SELECT 1 FROM experience_skills es JOIN skills s ON s.id = es.skill_id
               WHERE es.experience_id = e.id AND s.name = @skill)`
    )
    params.skill = filter.skill
  }
  if (filter.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM experience_tags et JOIN tags t ON t.id = et.tag_id
               WHERE et.experience_id = e.id AND t.name = @tag)`
    )
    params.tag = filter.tag
  }
  if (filter.dateStart) {
    where.push('COALESCE(e.happened_end, e.happened_start) >= @dateStart')
    params.dateStart = filter.dateStart
  }
  if (filter.dateEnd) {
    where.push('COALESCE(e.happened_start, e.happened_end) <= @dateEnd')
    params.dateEnd = filter.dateEnd
  }

  const sql = `
    SELECT e.id, e.title, e.context, e.status, e.happened_start, e.happened_end, e.updated_at,
           e.situation, e.task, e.action, e.result_text,
           (SELECT group_concat(s.name, char(31)) FROM experience_skills es
              JOIN skills s ON s.id = es.skill_id WHERE es.experience_id = e.id) AS skill_names,
           (SELECT group_concat(t.name, char(31)) FROM experience_tags et
              JOIN tags t ON t.id = et.tag_id WHERE et.experience_id = e.id) AS tag_names
    FROM experiences e
    ${joinFts ? 'JOIN experiences_fts ON experiences_fts.rowid = e.rowid' : ''}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${joinFts ? 'rank' : 'e.updated_at DESC'}
    LIMIT 500`

  return { sql, params }
}
