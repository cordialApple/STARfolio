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

export function parseMarkdown(md: string): ParsedNote {
  const normalized = md.replace(/\r\n/g, '\n')
  let fm: Record<string, string> = {}
  let body = normalized
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?/)
  if (fmMatch) {
    fm = parseFrontmatter(fmMatch[1])
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

  return {
    id: fm.id ? fm.id.trim() : null,
    created_at: fm.created_at || null,
    updated_at: fm.updated_at || null,
    title: fm.title ? unquote(fm.title) : '',
    situation: sections.situation ?? '',
    task: sections.task ?? '',
    action: sections.action ?? '',
    result_text: sections.result_text ?? '',
    context,
    happened_start: fm.happened_start || null,
    happened_end: fm.happened_end || null,
    status,
    skills: fm.skills ? parseFlowList(fm.skills).map(skillFromText) : [],
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
