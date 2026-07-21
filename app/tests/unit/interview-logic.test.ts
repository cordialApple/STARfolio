import { describe, it, expect } from 'vitest'
import {
  wordCount,
  durationSecs,
  formatSecs,
  formatDuration,
  starStoryToText,
  topThemes
} from '../../src/renderer/src/interview/interview-logic'
import type { InterviewReport, InterviewSessionDetail } from '../../src/renderer/src/lib/bank-types'

describe('wordCount', () => {
  it('counts whitespace-separated words', () => {
    expect(wordCount('one two three')).toBe(3)
  })
  it('collapses runs of whitespace', () => {
    expect(wordCount('  a\n\t b   c ')).toBe(3)
  })
  it('is 0 for blank input', () => {
    expect(wordCount('   ')).toBe(0)
    expect(wordCount('')).toBe(0)
  })
})

describe('durationSecs / formatSecs / formatDuration', () => {
  it('rounds elapsed seconds and never goes negative', () => {
    expect(durationSecs('2026-07-21T12:00:00', '2026-07-21T12:00:45')).toBe(45)
    expect(durationSecs('2026-07-21T12:01:00', '2026-07-21T12:00:00')).toBe(0)
  })
  it('formats sub-minute as sec and the rest as rounded min', () => {
    expect(formatSecs(45)).toBe('45 sec')
    expect(formatSecs(59)).toBe('59 sec')
    expect(formatSecs(60)).toBe('1 min')
    expect(formatSecs(90)).toBe('2 min')
  })
  it('formatDuration composes both', () => {
    expect(formatDuration('2026-07-21T12:00:00', '2026-07-21T12:02:00')).toBe('2 min')
  })
})

describe('starStoryToText', () => {
  const story = {
    topic: 'Payments migration',
    situation: 'Legacy gateway',
    task: 'Cut over',
    action: 'Wrote adapter',
    result: 'Zero downtime'
  } as InterviewReport['starStories'][number]

  it('joins topic then non-empty S/T/A/R rows', () => {
    expect(starStoryToText(story)).toBe(
      'Payments migration\nSituation: Legacy gateway\nTask: Cut over\nAction: Wrote adapter\nResult: Zero downtime'
    )
  })
  it('drops blank rows', () => {
    const partial = { ...story, task: '', result: '   ' }
    expect(starStoryToText(partial)).toBe(
      'Payments migration\nSituation: Legacy gateway\nAction: Wrote adapter'
    )
  })
})

describe('topThemes', () => {
  const detail = (areas: string[]): InterviewSessionDetail =>
    ({ report: { improvementAreas: areas } }) as unknown as InterviewSessionDetail

  it('tallies case-insensitively, keeps first-seen label, sorts by count desc, caps at 6', () => {
    const themes = topThemes([
      detail(['Depth', 'Metrics']),
      detail(['depth', 'Ownership']),
      null,
      detail(['DEPTH'])
    ])
    expect(themes[0]).toEqual({ label: 'Depth', count: 3 })
    expect(themes.map((t) => t.label)).toEqual(['Depth', 'Metrics', 'Ownership'])
  })
  it('ignores blank areas and null reports', () => {
    expect(topThemes([detail(['  ']), null])).toEqual([])
  })
  it('caps the result at 6 themes', () => {
    const many = topThemes([detail(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])])
    expect(many).toHaveLength(6)
  })
})
