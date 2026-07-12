import { Search, X } from 'lucide-react'
import { Input, Select, Button } from '../components'
import type { ExperienceStatus, ListFilter, Skill, Tag } from '../lib/bank-types'
import { CONTEXTS, CONTEXT_LABELS } from '../lib/format'

const STATUSES: ExperienceStatus[] = ['draft', 'confirmed']

export interface FilterBarProps {
  filter: ListFilter
  onChange: (next: ListFilter) => void
  skills: Skill[]
  tags: Tag[]
}

export function FilterBar({ filter, onChange, skills, tags }: FilterBarProps): React.JSX.Element {
  const set = (patch: Partial<ListFilter>): void => onChange({ ...filter, ...patch })
  const active =
    !!filter.context || !!filter.status || !!filter.skill || !!filter.tag || !!filter.query

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
        />
        <Input
          type="search"
          value={filter.query ?? ''}
          placeholder="Search or describe it — “a time I led under pressure”"
          onChange={(e) => set({ query: e.target.value || undefined })}
          className="pl-9"
          aria-label="Search experiences"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={filter.context ?? ''}
          onChange={(e) => set({ context: (e.target.value || undefined) as ListFilter['context'] })}
          className="w-auto"
          aria-label="Filter by context"
        >
          <option value="">All contexts</option>
          {CONTEXTS.map((c) => (
            <option key={c} value={c}>
              {CONTEXT_LABELS[c]}
            </option>
          ))}
        </Select>

        <Select
          value={filter.status ?? ''}
          onChange={(e) => set({ status: (e.target.value || undefined) as ListFilter['status'] })}
          className="w-auto"
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'draft' ? 'Drafts' : 'Confirmed'}
            </option>
          ))}
        </Select>

        {skills.length > 0 && (
          <Select
            value={filter.skill ?? ''}
            onChange={(e) => set({ skill: e.target.value || undefined })}
            className="w-auto"
            aria-label="Filter by skill"
          >
            <option value="">Any skill</option>
            {skills.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
        )}

        {tags.length > 0 && (
          <Select
            value={filter.tag ?? ''}
            onChange={(e) => set({ tag: e.target.value || undefined })}
            className="w-auto"
            aria-label="Filter by tag"
          >
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </Select>
        )}

        {active && (
          <Button variant="ghost" size="md" onClick={() => onChange({})}>
            <X className="size-4" />
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}
