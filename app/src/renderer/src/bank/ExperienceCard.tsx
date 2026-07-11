import { Badge, StarRail } from '../components'
import type { ExperienceSummary } from '../lib/bank-types'
import { CONTEXT_LABELS, CONTEXT_TONE, filledBeats, formatDateRange } from '../lib/format'

export interface ExperienceCardProps {
  experience: ExperienceSummary
  onOpen: (id: string) => void
}

export function ExperienceCard({ experience, onOpen }: ExperienceCardProps): React.JSX.Element {
  const { id, title, context, status, snippet, skills, tags, filled } = experience
  const dates = formatDateRange(experience.happened_start, experience.happened_end)
  const chips = [...skills, ...tags]

  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className="group flex w-full flex-col gap-2.5 rounded-xl border border-line bg-surface p-4 text-left shadow-card transition-[border-color,box-shadow] duration-150 ease-soft hover:border-line-strong hover:shadow-pop"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-ink group-hover:text-fg-brand">
          {title || 'Untitled experience'}
        </h3>
        <StarRail filled={filledBeats(filled)} variant="gutter" className="h-8 shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={CONTEXT_TONE[context]}>{CONTEXT_LABELS[context]}</Badge>
        {status === 'draft' && <Badge tone="warning">Draft</Badge>}
        {dates && <span className="text-xs text-muted">{dates}</span>}
      </div>

      {snippet && <p className="line-clamp-2 text-sm text-muted">{snippet}</p>}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.slice(0, 6).map((name) => (
            <span
              key={name}
              className="rounded-pill bg-raised px-2 py-0.5 text-xs font-medium text-muted"
            >
              {name}
            </span>
          ))}
          {chips.length > 6 && (
            <span className="px-1 text-xs text-faint">+{chips.length - 6}</span>
          )}
        </div>
      )}
    </button>
  )
}
