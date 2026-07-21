import type { InterviewReport, InterviewSessionDetail } from '../lib/bank-types'

export type ThemeCount = { label: string; count: number }

export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export function durationSecs(startedAt: string, endedAt: string): number {
  return Math.max(
    0,
    Math.round((new Date(endedAt + 'Z').getTime() - new Date(startedAt + 'Z').getTime()) / 1000)
  )
}

export function formatSecs(secs: number): string {
  return secs < 60 ? `${secs} sec` : `${Math.round(secs / 60)} min`
}

export function formatDuration(startedAt: string, endedAt: string): string {
  return formatSecs(durationSecs(startedAt, endedAt))
}

export function starStoryToText(story: InterviewReport['starStories'][number]): string {
  const rows: [string, string][] = [
    ['Situation', story.situation],
    ['Task', story.task],
    ['Action', story.action],
    ['Result', story.result]
  ]
  return [story.topic, ...rows.filter(([, v]) => v.trim()).map(([k, v]) => `${k}: ${v}`)].join('\n')
}

export function topThemes(details: (InterviewSessionDetail | null)[]): ThemeCount[] {
  const tally = new Map<string, ThemeCount>()
  for (const d of details) {
    for (const area of d?.report?.improvementAreas ?? []) {
      const key = area.trim().toLowerCase()
      if (!key) continue
      const hit = tally.get(key)
      if (hit) hit.count += 1
      else tally.set(key, { label: area.trim(), count: 1 })
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 6)
}
