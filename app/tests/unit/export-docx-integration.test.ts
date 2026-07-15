import { describe, expect, it } from 'vitest'
import { markdownToDocx } from '../../src/main/export/docx'
import {
  practiceToMarkdown,
  type PracticeEntry
} from '../../src/renderer/src/practice/practice-markdown'
import {
  technicalToMarkdown,
  type TechnicalEntry
} from '../../src/renderer/src/technical/technical-markdown'
import { debriefToMarkdown } from '../../src/renderer/src/interview/debrief-markdown'
import type {
  InterviewFeedback,
  TechnicalFeedback,
  InterviewSessionDetail
} from '../../src/preload/index.d'

async function roundTrip(md: string): Promise<string> {
  const buf = markdownToDocx(md)
  expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  const mammoth = (await import('mammoth')).default
  const { value } = await mammoth.extractRawText({ buffer: buf })
  return value
}

function expectNoLeakedMarkers(value: string): void {
  expect(value).not.toContain('**')
  expect(value).not.toContain('#')
  expect(value).not.toContain('_')
}

const practiceFeedback: InterviewFeedback = {
  star_completeness: { score: 4, note: 'All four parts present' },
  specificity: { score: 3, note: 'Name the systems' },
  measurable_result: { score: 5, note: 'Cut build time 20m to 4m' },
  length: { score: 4, note: 'Tight' },
  summary: 'Strong, quantified answer.'
}

const technicalFeedback: TechnicalFeedback = {
  correctness: { score: 4, note: 'Sound approach' },
  depth: { score: 3, note: 'Could go deeper' },
  tradeoffs: { score: 5, note: 'Weighed both sides' },
  communication: { score: 4, note: 'Clear' },
  summary: 'Solid answer with room on depth.'
}

const detail: InterviewSessionDetail = {
  id: 's1',
  candidateName: 'Ada Lovelace',
  level: 'senior',
  phase: 'done',
  startedAt: '2026-07-15 12:00:00',
  endedAt: '2026-07-15 12:30:00',
  transcript: [
    { speaker: 'interviewer', text: 'Tell me about the pipeline.' },
    { speaker: 'candidate', text: 'I led the migration to Kafka.' }
  ],
  report: {
    overallFeedback: 'Strong ownership.',
    strengths: ['Clear tradeoff reasoning'],
    improvementAreas: ['Go deeper on failure modes'],
    starStories: [
      {
        topic: 'Ingestion pipeline',
        situation: 'High latency',
        task: 'Cut p99',
        action: 'Rebuilt on Kafka',
        result: 'p99 down 60%'
      }
    ]
  }
}

describe('docx round-trips real transcript exports without leaking markdown', () => {
  it('practice transcript survives and leaks no markers', async () => {
    const entries: PracticeEntry[] = [
      { role: 'interviewer', text: 'Tell me about a time you led under pressure.' },
      {
        role: 'candidate',
        text: 'I rewrote the retry logic and cut build times.',
        feedback: practiceFeedback,
        used: [{ title: 'Deploy pipeline rewrite' }]
      }
    ]
    const value = await roundTrip(practiceToMarkdown('Leadership', entries))
    expect(value).toContain('Mock interview — Leadership')
    expect(value).toContain('Interviewer: Tell me about a time you led under pressure.')
    expect(value).toContain('Candidate: I rewrote the retry logic and cut build times.')
    expect(value).toContain('STAR completeness: 4/5 — All four parts present')
    expect(value).toContain('Drew on: Deploy pipeline rewrite')
    expectNoLeakedMarkers(value)
  })

  it('technical transcript survives and leaks no markers', async () => {
    const entries: TechnicalEntry[] = [
      {
        role: 'interviewer',
        text: 'How does your rate limiter handle partitions?',
        citations: [{ chunkId: 'c1', title: 'rate-limiter notes' }]
      },
      { role: 'candidate', text: 'Local token bucket fallback.', feedback: technicalFeedback }
    ]
    const value = await roundTrip(
      technicalToMarkdown('rate limiter design', 'distributed systems', entries)
    )
    expect(value).toContain('Technical practice — rate limiter design')
    expect(value).toContain('Discipline: distributed systems')
    expect(value).toContain('Interviewer: How does your rate limiter handle partitions?')
    expect(value).toContain('From your corpus: rate-limiter notes')
    expect(value).toContain('Candidate: Local token bucket fallback.')
    expect(value).toContain('Correctness: 4/5 — Sound approach')
    expectNoLeakedMarkers(value)
  })

  it('interview debrief survives and leaks no markers', async () => {
    const value = await roundTrip(debriefToMarkdown(detail))
    expect(value).toContain('Interview debrief — Ada Lovelace')
    expect(value).toContain('Interviewer: Tell me about the pipeline.')
    expect(value).toContain('Candidate: I led the migration to Kafka.')
    expect(value).toContain('Strong ownership.')
    expect(value).toContain('Clear tradeoff reasoning')
    expect(value).toContain('Go deeper on failure modes')
    expect(value).toContain('STAR — Ingestion pipeline')
    expect(value).toContain('Situation: High latency')
    expect(value).toContain('Result: p99 down 60%')
    expectNoLeakedMarkers(value)
  })
})
