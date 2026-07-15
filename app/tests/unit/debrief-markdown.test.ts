import { describe, expect, it } from 'vitest'
import {
  debriefFilename,
  debriefToMarkdown
} from '../../src/renderer/src/interview/debrief-markdown'
import type { InterviewSessionDetail } from '../../src/preload/index.d'

const base: InterviewSessionDetail = {
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

describe('debriefToMarkdown', () => {
  it('serializes name, transcript, and full report', () => {
    const md = debriefToMarkdown(base)
    expect(md).toContain('# Interview debrief — Ada Lovelace')
    expect(md).toContain('Senior')
    expect(md).toContain('**Interviewer:** Tell me about the pipeline.')
    expect(md).toContain('**Candidate:** I led the migration to Kafka.')
    expect(md).toContain('## Debrief')
    expect(md).toContain('Strong ownership.')
    expect(md).toContain('- Clear tradeoff reasoning')
    expect(md).toContain('- Go deeper on failure modes')
    expect(md).toContain('### STAR — Ingestion pipeline')
    expect(md).toContain('- **Result:** p99 down 60%')
  })

  it('falls back to Anonymous candidate and omits empty sections', () => {
    const md = debriefToMarkdown({
      ...base,
      candidateName: null,
      report: null,
      transcript: []
    })
    expect(md).toContain('# Interview debrief — Anonymous candidate')
    expect(md).not.toContain('## Transcript')
    expect(md).not.toContain('## Debrief')
  })

  it('keeps report sections it has and drops the ones it lacks', () => {
    const md = debriefToMarkdown({
      ...base,
      report: {
        overallFeedback: 'Solid.',
        strengths: [],
        improvementAreas: ['One gap'],
        starStories: []
      }
    })
    expect(md).toContain('Solid.')
    expect(md).not.toContain('### Strengths')
    expect(md).toContain('### Areas to improve')
    expect(md).not.toContain('### STAR')
  })
})

describe('debriefFilename', () => {
  it('slugifies the candidate name', () => {
    expect(debriefFilename(base)).toBe('interview-ada-lovelace')
  })

  it('collapses punctuation and trims dashes', () => {
    expect(debriefFilename({ ...base, candidateName: '  Ké$ha  O’Neil! ' })).toBe(
      'interview-k-ha-o-neil'
    )
  })

  it('falls back to anonymous when unnamed', () => {
    expect(debriefFilename({ ...base, candidateName: null })).toBe('interview-anonymous')
    expect(debriefFilename({ ...base, candidateName: '!!!' })).toBe('interview-anonymous')
  })
})
