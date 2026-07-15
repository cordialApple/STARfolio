import type { Citation, TechnicalFeedback, TechnicalRubricDimension } from '../lib/bank-types'

export type TechnicalEntry =
  | { role: 'interviewer'; text: string; citations: Citation[] }
  | { role: 'candidate'; text: string; feedback: TechnicalFeedback }

export const DIMS: { key: TechnicalRubricDimension; label: string }[] = [
  { key: 'correctness', label: 'Correctness' },
  { key: 'depth', label: 'Depth' },
  { key: 'tradeoffs', label: 'Trade-offs' },
  { key: 'communication', label: 'Communication' }
]

export function technicalToMarkdown(
  topic: string,
  discipline: string | undefined,
  entries: TechnicalEntry[]
): string {
  const out: string[] = [`# Technical practice — ${topic}`]
  if (discipline?.trim()) out.push('', `**Discipline:** ${discipline.trim()}`)

  for (const e of entries) {
    if (e.role === 'interviewer') {
      out.push('', `**Interviewer:** ${e.text}`)
      if (e.citations.length > 0)
        out.push(`_From your corpus: ${e.citations.map((c) => c.title).join(', ')}_`)
    } else {
      out.push('', `**Candidate:** ${e.text}`)
      for (const { key, label } of DIMS)
        out.push(`- ${label}: ${e.feedback[key].score}/5 — ${e.feedback[key].note}`)
      out.push('', e.feedback.summary)
    }
  }

  return out.join('\n')
}
