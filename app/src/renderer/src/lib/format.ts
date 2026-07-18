import type { ExperienceContext, SkillKind } from './bank-types'
import type { BadgeTone, StarBeat } from '../components'

export const CONTEXTS: ExperienceContext[] = ['work', 'project', 'class', 'other']

export const CONTEXT_LABELS: Record<ExperienceContext, string> = {
  work: 'Work',
  project: 'Project',
  class: 'Class',
  other: 'Other'
}

export const CONTEXT_TONE: Record<ExperienceContext, BadgeTone> = {
  work: 'brand',
  project: 'info',
  class: 't',
  other: 'neutral'
}

export const SKILL_KIND_LABELS: Record<SkillKind, string> = {
  technical: 'Technical',
  soft: 'Soft',
  domain: 'Domain'
}

export const SKILL_KIND_DOT: Record<SkillKind, string> = {
  technical: 'bg-star-s',
  soft: 'bg-star-t',
  domain: 'bg-star-a'
}

export const BEAT_ACCENT: Record<StarBeat, string> = {
  s: 'border-l-star-s',
  t: 'border-l-star-t',
  a: 'border-l-star-a',
  r: 'border-l-star-r'
}

export function filledBeats(filled: {
  situation: boolean
  task: boolean
  action: boolean
  result: boolean
}): StarBeat[] {
  const beats: StarBeat[] = []
  if (filled.situation) beats.push('s')
  if (filled.task) beats.push('t')
  if (filled.action) beats.push('a')
  if (filled.result) beats.push('r')
  return beats
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMonth(iso: string): string {
  const [y, m] = iso.split('-')
  const mi = Number(m) - 1
  return mi >= 0 && mi < 12 ? `${MONTHS[mi]} ${y}` : y
}

export function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return ''
  if (start && !end) return fmtMonth(start)
  if (!start && end) return `until ${fmtMonth(end)}`
  const a = fmtMonth(start!)
  const b = fmtMonth(end!)
  return a === b ? a : `${a} – ${b}`
}
