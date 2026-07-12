import { Badge, type BadgeTone } from '../components'
import type { InterviewFeedback, RubricDimension } from '../lib/bank-types'

const DIMENSION_LABELS: Record<RubricDimension, string> = {
  star_completeness: 'STAR completeness',
  specificity: 'Specificity',
  measurable_result: 'Measurable result',
  length: 'Length'
}
const DIMENSIONS: RubricDimension[] = [
  'star_completeness',
  'specificity',
  'measurable_result',
  'length'
]

function toneFor(score: number): BadgeTone {
  if (score <= 2) return 'danger'
  if (score === 3) return 'warning'
  return 'success'
}

export function FeedbackCard({ feedback }: { feedback: InterviewFeedback }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-raised/60 p-4">
      <p className="mb-3 text-sm text-ink">{feedback.summary}</p>
      <dl className="grid gap-2 sm:grid-cols-2">
        {DIMENSIONS.map((d) => {
          const s = feedback[d]
          return (
            <div key={d} className="flex items-start gap-2">
              <Badge tone={toneFor(s.score)} className="mt-0.5 shrink-0 tabular-nums">
                {s.score}/5
              </Badge>
              <div className="min-w-0">
                <dt className="text-xs font-semibold text-ink">{DIMENSION_LABELS[d]}</dt>
                <dd className="text-xs text-muted">{s.note}</dd>
              </div>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
