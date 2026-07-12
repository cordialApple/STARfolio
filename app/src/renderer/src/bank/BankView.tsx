import { useEffect, useState } from 'react'
import { Plus, Inbox, FileText, Sparkles, Loader2 } from 'lucide-react'
import { Button, EmptyState, ErrorState, Skeleton } from '../components'
import type { ExperienceSummary, ListFilter, ModelStatus, Skill, Tag } from '../lib/bank-types'
import { FilterBar } from './FilterBar'
import { ExperienceCard } from './ExperienceCard'

export interface BankViewProps {
  reloadToken: number
  onOpen: (id: string) => void
  onNew: () => void
  onBrainDump: () => void
}

export function BankView({
  reloadToken,
  onOpen,
  onNew,
  onBrainDump
}: BankViewProps): React.JSX.Element {
  const [filter, setFilter] = useState<ListFilter>({})
  const [items, setItems] = useState<ExperienceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [model, setModel] = useState<ModelStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      setError(null)
      try {
        const list = await window.api.bank.search(filter)
        if (!cancelled) setItems(list)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [filter, reloadToken])

  useEffect(() => {
    void window.api.embed.modelStatus().then(setModel)
    return window.api.embed.onStatus(setModel)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [s, t] = await Promise.all([window.api.bank.skills(), window.api.bank.tags()])
      if (!cancelled) {
        setSkills(s)
        setTags(t)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const filtered = !!filter.query || !!filter.context || !!filter.status || !!filter.skill || !!filter.tag
  const draftCount = items?.filter((i) => i.status === 'draft').length ?? 0

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Your bank</h1>
          <p className="text-sm text-muted">Every accomplishment, in STAR form.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onBrainDump}>
            <Sparkles className="size-4" />
            Brain dump
          </Button>
          <Button onClick={onNew}>
            <Plus className="size-4" />
            New experience
          </Button>
        </div>
      </div>

      <FilterBar filter={filter} onChange={setFilter} skills={skills} tags={tags} />

      {model?.phase === 'downloading' && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Loader2 className="size-3.5 animate-spin" />
          Preparing smart search ({model.progress}%) — keyword results shown until it&apos;s ready.
        </p>
      )}

      {draftCount > 0 && filter.status !== 'draft' && (
        <button
          type="button"
          onClick={() => setFilter((f) => ({ ...f, status: 'draft' }))}
          className="inline-flex items-center gap-1.5 rounded-pill bg-warning/15 px-3 py-1 text-xs font-semibold text-fg-warning hover:bg-warning/25"
        >
          <FileText className="size-3.5" />
          {draftCount} {draftCount === 1 ? 'draft' : 'drafts'} to finish
        </button>
      )}

      {error ? (
        <ErrorState
          description={error}
          action={<Button onClick={() => setFilter((f) => ({ ...f }))}>Retry</Button>}
        />
      ) : items === null ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Inbox}
            title="No matches"
            description="Nothing fits these filters yet. Try loosening them."
            action={<Button variant="secondary" onClick={() => setFilter({})}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="Your bank is empty"
            description="Log your first accomplishment. Even a rough draft is a start — you can polish it later."
            action={
              <Button onClick={onNew}>
                <Plus className="size-4" />
                Log your first experience
              </Button>
            }
          />
        )
      ) : (
        <ul className="space-y-3">
          {items.map((exp) => (
            <li key={exp.id}>
              <ExperienceCard experience={exp} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
