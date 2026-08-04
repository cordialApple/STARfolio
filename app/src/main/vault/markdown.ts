import { CONTEXTS, STATUSES, SKILL_KINDS } from '../db/repositories/experiences'

type Context = (typeof CONTEXTS)[number]
type Status = (typeof STATUSES)[number]
type SkillKind = (typeof SKILL_KINDS)[number]

export interface VaultSkill {
  name: string
  kind: SkillKind
}
export interface VaultMetric {
  label: string
  value: number | null
  unit: string | null
}
export interface VaultExperience {
  id: string
  title: string
  situation: string
  task: string
  action: string
  result_text: string
  context: Context
  happened_start: string | null
  happened_end: string | null
  status: Status
  created_at?: string
  updated_at?: string
  skills: VaultSkill[]
  tags: string[]
  metrics: VaultMetric[]
}

export interface ParsedNote {
  id: string | null
  created_at: string | null
  updated_at: string | null
  title: string
  situation: string
  task: string
  action: string
  result_text: string
  context: Context
  happened_start: string | null
  happened_end: string | null
  status: Status
  skills: VaultSkill[]
  tags: string[]
  metrics: VaultMetric[]
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function unescapeQuoted(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return unescapeQuoted(t.slice(1, -1))
  }
  return t
}

function formatFlowList(items: string[]): string {
  return `[${items.map(quote).join(', ')}]`
}

function parseFlowList(raw: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    out.push(unescapeQuoted(m[1]))
  }
  if (out.length === 0) {
    const inner = raw.replace(/^\[/, '').replace(/\]$/, '').trim()
    if (inner) for (const p of inner.split(',')) out.push(p.trim())
  }
  return out
}

function skillToText(s: VaultSkill): string {
  return s.kind === 'technical' ? s.name : `${s.name} (${s.kind})`
}

function skillFromText(text: string): VaultSkill {
  const m = text.match(/^(.*?)\s*\((technical|soft|domain)\)$/)
  if (m) return { name: m[1].trim(), kind: m[2] as SkillKind }
  return { name: text.trim(), kind: 'technical' }
}

function metricToText(m: VaultMetric): string {
  const tail = [m.value != null ? String(m.value) : '', m.unit ?? ''].filter(Boolean).join(' ')
  return tail ? `- ${m.label}: ${tail}` : `- ${m.label}:`
}

function metricFromText(line: string): VaultMetric | null {
  const m = line.match(/^-\s*(.+?):\s*(.*)$/)
  if (!m) return null
  const label = m[1].trim()
  if (!label) return null
  const rest = m[2].trim()
  if (!rest) return { label, value: null, unit: null }
  const num = rest.match(/^([+-]?\d+(?:\.\d+)?)\s*(.*)$/)
  if (num) {
    const unit = num[2].trim()
    return { label, value: Number(num[1]), unit: unit || null }
  }
  return { label, value: null, unit: rest }
}

const SECTION_KEYS: Record<string, 'situation' | 'task' | 'action' | 'result_text'> = {
  situation: 'situation',
  task: 'task',
  action: 'action',
  result: 'result_text'
}

export function experienceToMarkdown(exp: VaultExperience): string {
  const fm: string[] = ['---', `id: ${exp.id}`, `title: ${quote(exp.title)}`]
  fm.push(`context: ${exp.context}`, `status: ${exp.status}`)
  if (exp.happened_start) fm.push(`happened_start: ${exp.happened_start}`)
  if (exp.happened_end) fm.push(`happened_end: ${exp.happened_end}`)
  if (exp.created_at) fm.push(`created_at: ${exp.created_at}`)
  if (exp.updated_at) fm.push(`updated_at: ${exp.updated_at}`)
  fm.push(`skills: ${formatFlowList(exp.skills.map(skillToText))}`)
  fm.push(`tags: ${formatFlowList(exp.tags)}`)
  fm.push('---')

  const body: string[] = [
    `# ${exp.title || 'Untitled'}`,
    '',
    '## Situation',
    exp.situation,
    '',
    '## Task',
    exp.task,
    '',
    '## Action',
    exp.action,
    '',
    '## Result',
    exp.result_text
  ]
  if (exp.metrics.length) {
    body.push('', '## Metrics', ...exp.metrics.map(metricToText))
  }
  return `${fm.join('\n')}\n\n${body.join('\n')}\n`
}

function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    out[key] = line.slice(idx + 1).trim()
  }
  return out
}

function assignKeyValue(target: Record<string, string>, s: string): void {
  const idx = s.indexOf(':')
  if (idx > 0) target[s.slice(0, idx).trim()] = unquote(s.slice(idx + 1).trim())
  else if (s) target._ = unquote(s)
}

// Frontmatter carries skills/metrics as YAML block sequences (a `key:` line, then indented `- `
// items); the flat key:value scan can't see those, so pull them straight from the raw block.
function parseBlockSeq(fmText: string, key: string): Record<string, string>[] {
  const items: Record<string, string>[] = []
  let inKey = false
  let cur: Record<string, string> | null = null
  for (const line of fmText.split('\n')) {
    if (!inKey) {
      if (line.trim() === `${key}:`) inKey = true
      continue
    }
    if (line.trim() === '') continue
    if (!/^\s/.test(line)) break
    const body = line.trim()
    if (body.startsWith('- ')) {
      cur = {}
      items.push(cur)
      assignKeyValue(cur, body.slice(2).trim())
    } else if (cur) {
      assignKeyValue(cur, body)
    }
  }
  return items
}

function skillFromMap(m: Record<string, string>): VaultSkill | null {
  const name = (m.name ?? m._ ?? '').trim()
  if (!name) return null
  const kind = (SKILL_KINDS as readonly string[]).includes(m.kind)
    ? (m.kind as SkillKind)
    : 'technical'
  return { name, kind }
}

function metricFromMap(m: Record<string, string>): VaultMetric | null {
  const label = (m.label ?? m._ ?? '').trim()
  if (!label) return null
  const n = m.value != null && m.value !== '' ? Number(m.value) : null
  return { label, value: n != null && Number.isFinite(n) ? n : null, unit: m.unit?.trim() || null }
}

export function parseMarkdown(md: string): ParsedNote {
  const normalized = md.replace(/\r\n/g, '\n')
  let fm: Record<string, string> = {}
  let body = normalized
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?/)
  const fmText = fmMatch ? fmMatch[1] : ''
  if (fmMatch) {
    fm = parseFrontmatter(fmText)
    body = normalized.slice(fmMatch[0].length)
  }

  const sections: Record<string, string> = {}
  const parts = body.split(/^##\s+/m)
  let metrics: VaultMetric[] = []
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n')
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim().toLowerCase()
    const content = (nl === -1 ? '' : part.slice(nl + 1)).replace(/\n+$/, '')
    if (heading === 'metrics') {
      metrics = content
        .split('\n')
        .map(metricFromText)
        .filter((m): m is VaultMetric => m != null)
    } else if (SECTION_KEYS[heading]) {
      sections[SECTION_KEYS[heading]] = content.trim()
    }
  }

  const context = (CONTEXTS as readonly string[]).includes(fm.context)
    ? (fm.context as Context)
    : 'work'
  const status = (STATUSES as readonly string[]).includes(fm.status)
    ? (fm.status as Status)
    : 'draft'

  const h1 = (parts[0] ?? '').match(/^#\s+(.+?)\s*$/m)
  const title = fm.title ? unquote(fm.title) : h1 ? h1[1].trim() : ''

  const skills = fm.skills
    ? parseFlowList(fm.skills).map(skillFromText)
    : parseBlockSeq(fmText, 'skills')
        .map(skillFromMap)
        .filter((s): s is VaultSkill => s != null)
  if (!metrics.length) {
    metrics = parseBlockSeq(fmText, 'metrics')
      .map(metricFromMap)
      .filter((m): m is VaultMetric => m != null)
  }

  return {
    id: fm.id ? fm.id.trim() : null,
    created_at: fm.created_at || null,
    updated_at: fm.updated_at || null,
    title,
    situation: sections.situation ?? '',
    task: sections.task ?? '',
    action: sections.action ?? '',
    result_text: sections.result_text ?? '',
    context,
    happened_start: fm.happened_start || null,
    happened_end: fm.happened_end || null,
    status,
    skills,
    tags: fm.tags ? parseFlowList(fm.tags) : [],
    metrics
  }
}

export function slugFor(exp: Pick<VaultExperience, 'id' | 'title'>): string {
  const base = exp.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const stem = base || 'note'
  return `${stem}-${exp.id.slice(0, 8)}.md`
}
