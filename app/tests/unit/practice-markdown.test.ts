import { describe, expect, it } from 'vitest'
import {
  practiceToMarkdown,
  practiceFilename,
  type PracticeEntry
} from '../../src/renderer/src/practice/practice-markdown'
import type { InterviewFeedback } from '../../src/preload/index.d'

const feedback: InterviewFeedback = {
  star_completeness: { score: 4, note: 'All four parts present' },
  specificity: { score: 3, note: 'Name the systems' },
  measurable_result: { score: 5, note: 'Cut build time 20m to 4m' },
  length: { score: 4, note: 'Tight' },
  summary: 'Strong, quantified answer.'
}

const entries: PracticeEntry[] = [
  { role: 'interviewer', text: 'Tell me about a time you led under pressure.' },
  {
    role: 'candidate',
    text: 'I rewrote the retry logic and cut build times.',
    feedback,
    used: [{ title: 'Deploy pipeline rewrite' }]
  }
]

describe('practiceToMarkdown', () => {
  it('serializes prompt, questions, rubric, summary, and drew-on titles', () => {
    const md = practiceToMarkdown('Leadership', entries)
    expect(md).toContain('# Mock interview — Leadership')
    expect(md).toContain('**Interviewer:** Tell me about a time you led under pressure.')
    expect(md).toContain('**Candidate:** I rewrote the retry logic and cut build times.')
    expect(md).toContain('- STAR completeness: 4/5 — All four parts present')
    expect(md).toContain('- Measurable result: 5/5 — Cut build time 20m to 4m')
    expect(md).toContain('Strong, quantified answer.')
    expect(md).toContain('_Drew on: Deploy pipeline rewrite_')
  })

  it('omits rubric and drew-on for a candidate turn still awaiting feedback', () => {
    const md = practiceToMarkdown('Teamwork', [
      { role: 'interviewer', text: 'Describe a conflict.' },
      { role: 'candidate', text: 'We disagreed on scope.' }
    ])
    expect(md).toContain('**Candidate:** We disagreed on scope.')
    expect(md).not.toContain('/5 —')
    expect(md).not.toContain('Drew on')
  })
})

describe('practiceFilename', () => {
  it('slugifies the prompt into a practice- prefixed name', () => {
    expect(practiceFilename('Conflict resolution')).toBe('practice-conflict-resolution')
  })

  it('falls back to practice-session when the prompt slugifies to empty', () => {
    expect(practiceFilename('   ')).toBe('practice-session')
  })
})
