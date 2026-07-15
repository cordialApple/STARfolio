import type { InterviewSessionDetail } from '../lib/bank-types'

const LEVEL_LABEL: Record<InterviewSessionDetail['level'], string> = {
  entry: 'Entry level',
  mid: 'Mid level',
  senior: 'Senior'
}

function list(items: string[]): string {
  return items.map((i) => `- ${i}`).join('\n')
}

export function debriefFilename(detail: InterviewSessionDetail): string {
  const slug = (detail.candidateName ?? '')
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `interview-${slug || 'anonymous'}`
}

export function debriefToMarkdown(detail: InterviewSessionDetail): string {
  const name = detail.candidateName ?? 'Anonymous candidate'
  const when = new Date(detail.startedAt + 'Z').toLocaleString()
  const out: string[] = [
    `# Interview debrief — ${name}`,
    '',
    `${when} · ${LEVEL_LABEL[detail.level]}`
  ]

  if (detail.transcript.length > 0) {
    out.push('', '## Transcript')
    for (const t of detail.transcript) {
      out.push('', `**${t.speaker === 'interviewer' ? 'Interviewer' : 'Candidate'}:** ${t.text}`)
    }
  }

  const report = detail.report
  if (report) {
    out.push('', '## Debrief', '', report.overallFeedback)
    if (report.strengths.length > 0) out.push('', '### Strengths', list(report.strengths))
    if (report.improvementAreas.length > 0)
      out.push('', '### Areas to improve', list(report.improvementAreas))
    for (const s of report.starStories) {
      out.push(
        '',
        `### STAR — ${s.topic}`,
        `- **Situation:** ${s.situation}`,
        `- **Task:** ${s.task}`,
        `- **Action:** ${s.action}`,
        `- **Result:** ${s.result}`
      )
    }
  }

  return out.join('\n')
}
