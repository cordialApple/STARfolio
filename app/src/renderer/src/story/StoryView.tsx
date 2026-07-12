import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Search, Copy, Save, RefreshCw, Square, Check } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Select,
  Skeleton,
  Textarea,
  useToast
} from '../components'
import type {
  ExperienceSummary,
  StoryKind,
  StoryLength,
  StoryTone
} from '../lib/bank-types'
import { CONTEXT_LABELS, CONTEXT_TONE } from '../lib/format'
import { cn } from '../lib/cn'

const GENRES: { label: string; query: string }[] = [
  { label: 'Leadership', query: 'led a team took ownership drove an initiative' },
  { label: 'Problem solving', query: 'solved a hard problem debugged found the root cause' },
  { label: 'Teamwork', query: 'collaborated across a team cross-functional partners' },
  { label: 'Conflict', query: 'disagreement conflict difficult stakeholder resolved' },
  { label: 'Handling failure', query: 'failure mistake setback what I learned recovered' },
  { label: 'Under pressure', query: 'tight deadline pressure urgent shipped fast' }
]

const LENGTHS: { value: StoryLength; label: string }[] = [
  { value: 'short', label: '30 seconds' },
  { value: 'medium', label: '90 seconds' },
  { value: 'detailed', label: 'Detailed' }
]
const TONES: { value: StoryTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'confident', label: 'Confident' }
]

const MAX_SELECTED = 12
const PRESELECT = 4

export function StoryView(): React.JSX.Element {
  const toast = useToast()
  const [mode, setMode] = useState<StoryKind>('jd')
  const [jd, setJd] = useState('')
  const [genre, setGenre] = useState(GENRES[0].label)

  const [candidates, setCandidates] = useState<ExperienceSummary[] | null>(null)
  const [retrieving, setRetrieving] = useState(false)
  const [retrieveError, setRetrieveError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [length, setLength] = useState<StoryLength>('medium')
  const [tone, setTone] = useState<StoryTone>('professional')
  const [notes, setNotes] = useState('')

  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)

  const reqRef = useRef<string | null>(null)
  const parentRef = useRef<string | null>(null)

  useEffect(() => {
    const off = [
      window.api.ai.onToken((id, token) => {
        if (id === reqRef.current) setOutput((o) => o + token)
      }),
      window.api.ai.onDone((id) => {
        if (id === reqRef.current) {
          setStreaming(false)
          setDone(true)
        }
      }),
      window.api.ai.onError((id, msg) => {
        if (id === reqRef.current) {
          setStreaming(false)
          setGenError(msg)
        }
      })
    ]
    return () => off.forEach((fn) => fn())
  }, [])

  const promptText = mode === 'jd' ? jd.trim() : genre
  const query = mode === 'jd' ? jd.trim() : (GENRES.find((g) => g.label === genre)?.query ?? genre)

  const retrieve = useCallback(async (): Promise<void> => {
    setRetrieving(true)
    setRetrieveError(null)
    try {
      const rows = await window.api.bank.search({ query, status: 'confirmed' })
      setCandidates(rows)
      setSelected(new Set(rows.slice(0, PRESELECT).map((r) => r.id)))
    } catch (err) {
      setRetrieveError((err as Error).message)
    } finally {
      setRetrieving(false)
    }
  }, [query])

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < MAX_SELECTED) next.add(id)
      return next
    })
  }

  async function generate(): Promise<void> {
    if (selected.size === 0) return
    const requestId = crypto.randomUUID()
    reqRef.current = requestId
    setOutput('')
    setGenError(null)
    setDone(false)
    setSavedId(null)
    setStreaming(true)
    try {
      await window.api.story.generate({
        requestId,
        experienceIds: [...selected],
        kind: mode,
        promptText,
        length,
        tone,
        notes: notes.trim() || undefined
      })
    } catch (err) {
      setStreaming(false)
      setGenError((err as Error).message)
    }
  }

  function stop(): void {
    if (reqRef.current) void window.api.story.cancel(reqRef.current)
    setStreaming(false)
  }

  async function copy(): Promise<void> {
    try {
      await window.api.clipboard.write(output)
      toast('Story copied to clipboard.', 'success')
    } catch (err) {
      toast(`Could not copy: ${(err as Error).message}`, 'danger')
    }
  }

  async function save(): Promise<void> {
    try {
      const story = await window.api.story.save({
        content: output,
        experienceIds: [...selected],
        prompt: { kind: mode, promptText, length, tone },
        notes: notes.trim() || null,
        parentStoryId: parentRef.current
      })
      parentRef.current = story.id
      setSavedId(story.id)
      toast('Story saved.', 'success')
    } catch (err) {
      toast(`Could not save: ${(err as Error).message}`, 'danger')
    }
  }

  const selectedTitles = (candidates ?? [])
    .filter((c) => selected.has(c.id))
    .map((c) => ({ id: c.id, title: c.title || 'Untitled experience' }))

  const canRetrieve = mode === 'genre' || jd.trim().length > 0

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Generate a story</h1>
        <p className="text-sm text-muted">
          Point it at a job description or a theme. It builds a STAR answer from your real
          experiences — nothing invented.
        </p>
      </div>

      <Card title="1 · What's the story for?">
        <div className="space-y-4">
          <div className="inline-flex rounded-lg border border-line p-0.5">
            <TabButton active={mode === 'jd'} onClick={() => setMode('jd')}>
              Paste a job description
            </TabButton>
            <TabButton active={mode === 'genre'} onClick={() => setMode('genre')}>
              Pick a theme
            </TabButton>
          </div>

          {mode === 'jd' ? (
            <Textarea
              rows={6}
              value={jd}
              placeholder="Paste the job description or the specific requirement you want to speak to…"
              onChange={(e) => setJd(e.target.value)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {GENRES.map((g) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => setGenre(g.label)}
                  aria-pressed={genre === g.label}
                  className={cn(
                    'rounded-pill px-3 py-1.5 text-sm font-semibold transition-colors',
                    genre === g.label
                      ? 'bg-brand-strong text-on-brand'
                      : 'border border-line bg-surface text-ink hover:bg-raised'
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              variant="secondary"
              loading={retrieving}
              disabled={retrieving || !canRetrieve}
              onClick={() => void retrieve()}
            >
              <Search className="size-4" />
              Find experiences
            </Button>
          </div>
        </div>
      </Card>

      {retrieveError && <ErrorState description={retrieveError} />}

      {retrieving && candidates === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : candidates !== null ? (
        <Card title="2 · Pick what to draw from">
          {candidates.length === 0 ? (
            <EmptyState
              title="No confirmed experiences match"
              description="Confirm a few experiences in your bank, or try a different theme."
            />
          ) : (
            <ul className="space-y-2">
              {candidates.map((c) => {
                const on = selected.has(c.id)
                return (
                  <li key={c.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                        on ? 'border-brand bg-brand-soft/40' : 'border-line hover:bg-raised'
                      )}
                    >
                      <Checkbox
                        checked={on}
                        onChange={() => toggle(c.id)}
                        className="mt-0.5"
                        aria-label={`Include ${c.title || 'Untitled experience'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-semibold text-ink">
                            {c.title || 'Untitled experience'}
                          </span>
                          <Badge tone={CONTEXT_TONE[c.context]}>{CONTEXT_LABELS[c.context]}</Badge>
                        </span>
                        {c.snippet && (
                          <span className="mt-0.5 line-clamp-2 block text-sm text-muted">
                            {c.snippet}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          {candidates.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted">Length</span>
                <Select value={length} onChange={(e) => setLength(e.target.value as StoryLength)}>
                  {LENGTHS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold text-muted">Tone</span>
                <Select value={tone} onChange={(e) => setTone(e.target.value as StoryTone)}>
                  {TONES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          )}

          {candidates.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs text-muted">
                {selected.size} selected{selected.size >= MAX_SELECTED ? ' (max)' : ''}
              </p>
              <Button
                loading={streaming}
                disabled={streaming || selected.size === 0}
                onClick={() => void generate()}
              >
                <Sparkles className="size-4" />
                Generate story
              </Button>
            </div>
          )}
        </Card>
      ) : null}

      {(streaming || output || genError) && (
        <Card title="3 · Your story">
          {genError ? (
            <ErrorState description={genError} />
          ) : (
            <>
              <p className="min-h-24 whitespace-pre-wrap text-ink">
                {output}
                {streaming && <span className="ml-0.5 animate-pulse text-muted">▍</span>}
              </p>

              {selectedTitles.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
                    Built from
                  </h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {selectedTitles.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-pill bg-raised px-2.5 py-0.5 text-xs font-medium text-muted"
                      >
                        {s.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {streaming ? (
                  <Button size="sm" variant="secondary" onClick={stop}>
                    <Square className="size-4" />
                    Stop
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => void copy()} disabled={!output}>
                      <Copy className="size-4" />
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void save()}
                      disabled={!output || savedId !== null}
                    >
                      {savedId ? <Check className="size-4" /> : <Save className="size-4" />}
                      {savedId ? 'Saved' : 'Save'}
                    </Button>
                    {done && (
                      <Button size="sm" variant="ghost" onClick={() => void generate()}>
                        <RefreshCw className="size-4" />
                        Regenerate
                      </Button>
                    )}
                  </>
                )}
              </div>

              {done && (
                <div className="mt-3">
                  <Textarea
                    rows={2}
                    value={notes}
                    placeholder="Notes to steer a regenerate — e.g. 'lead with the metric', 'shorter', 'emphasize teamwork'…"
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
        active ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}
