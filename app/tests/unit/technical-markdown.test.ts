import { describe, expect, it } from 'vitest'
import {
  technicalToMarkdown,
  technicalFilename,
  type TechnicalEntry
} from '../../src/renderer/src/technical/technical-markdown'
import type { TechnicalFeedback } from '../../src/preload/index.d'

const feedback: TechnicalFeedback = {
  correctness: { score: 4, note: 'Sound approach' },
  depth: { score: 3, note: 'Could go deeper' },
  tradeoffs: { score: 5, note: 'Weighed both sides' },
  communication: { score: 4, note: 'Clear' },
  summary: 'Solid answer with room on depth.'
}

const entries: TechnicalEntry[] = [
  {
    role: 'interviewer',
    text: 'How does your rate limiter handle partitions?',
    citations: [{ chunkId: 'c1', title: 'rate-limiter notes' }]
  },
  { role: 'candidate', text: 'Local token bucket fallback.', feedback }
]

describe('technicalToMarkdown', () => {
  it('serializes topic, discipline, questions, citations, and rubric', () => {
    const md = technicalToMarkdown('rate limiter design', 'distributed systems', entries)
    expect(md).toContain('# Technical practice — rate limiter design')
    expect(md).toContain('**Discipline:** distributed systems')
    expect(md).toContain('**Interviewer:** How does your rate limiter handle partitions?')
    expect(md).toContain('_From your corpus: rate-limiter notes_')
    expect(md).toContain('**Candidate:** Local token bucket fallback.')
    expect(md).toContain('- Correctness: 4/5 — Sound approach')
    expect(md).toContain('- Trade-offs: 5/5 — Weighed both sides')
    expect(md).toContain('Solid answer with room on depth.')
  })

  it('omits discipline when blank and corpus line when no citations', () => {
    const md = technicalToMarkdown('caching', '  ', [
      { role: 'interviewer', text: 'What eviction policy?', citations: [] }
    ])
    expect(md).not.toContain('**Discipline:**')
    expect(md).not.toContain('From your corpus')
    expect(md).toContain('**Interviewer:** What eviction policy?')
  })
})

describe('technicalFilename', () => {
  it('slugifies the topic into a technical- prefixed name', () => {
    expect(technicalFilename('the consensus protocol')).toBe('technical-the-consensus-protocol')
  })

  it('falls back to technical-session when the topic slugifies to empty', () => {
    expect(technicalFilename('   ')).toBe('technical-session')
  })
})
