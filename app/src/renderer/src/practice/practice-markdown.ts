import { slugify } from '../lib/format'
import type { InterviewFeedback, RubricDimension } from '../lib/bank-types'

export type PracticeEntry =
  | { role: 'interviewer'; text: string }
  | { role: 'candidate'; text: string; feedback?: InterviewFeedback; used?: { title: string }[] }

export const DIMS: { key: RubricDimension; label: string }[] = [
  { key: 'star_completeness', label: 'STAR completeness' },
  { key: 'specificity', label: 'Specificity' },
  { key: 'measurable_result', label: 'Measurable result' },
  { key: 'length', label: 'Length' }
]

export function practiceFilename(promptText: string): string {
  return `practice-${slugify(promptText) || 'session'}`
}

export function practiceToMarkdown(promptText: string, entries: PracticeEntry[]): string {
  const out: string[] = [`# Mock interview — ${promptText}`]

  for (const e of entries) {
    if (e.role === 'interviewer') {
      out.push('', `**Interviewer:** ${e.text}`)
    } else {
      out.push('', `**Candidate:** ${e.text}`)
      if (e.feedback) {
        for (const { key, label } of DIMS)
          out.push(`- ${label}: ${e.feedback[key].score}/5 — ${e.feedback[key].note}`)
        out.push('', e.feedback.summary)
      }
      if (e.used && e.used.length > 0)
        out.push(`_Drew on: ${e.used.map((u) => u.title).join(', ')}_`)
    }
  }

  return out.join('\n')
}
