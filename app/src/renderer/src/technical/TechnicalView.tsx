import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, Quote, Copy, History, Inbox, Square, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Skeleton,
  Textarea,
  useToast
} from '../components'
import type {
  Citation,
  TechnicalFeedback,
  TechnicalSession,
  TechnicalSessionSummary
} from '../lib/bank-types'
import { DIMS, technicalToMarkdown, type TechnicalEntry } from './technical-markdown'

type Entry = TechnicalEntry
type Phase = 'setup' | 'live' | 'history' | 'transcript'

function scoreTone(score: number): 'success' | 'warning' | 'danger' {
  return score >= 4 ? 'success' : score === 3 ? 'warning' : 'danger'
}

function FeedbackGrid({ feedback }: { feedback: TechnicalFeedback }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="grid grid-cols-2 gap-2">
        {DIMS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted">{label}</span>
            <Badge tone={scoreTone(feedback[key].score)}>{feedback[key].score}/5</Badge>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm text-ink">{feedback.summary}</p>
    </div>
  )
}

function Citations({ citations }: { citations: Citation[] }): React.JSX.Element | null {
  if (citations.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-faint">
      <Quote className="size-3.5" />
      <span className="font-semibold">From your corpus:</span>
      {citations.map((c) => (
        <span key={c.chunkId} className="rounded-pill bg-raised px-2 py-0.5 text-ink">
          {c.title}
        </span>
      ))}
    </div>
  )
}

export function TechnicalView(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('setup')
  const [topic, setTopic] = useState('')
  const [discipline, setDiscipline] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const toast = useToast()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries])

  async function start(): Promise<void> {
    if (!topic.trim()) return
    setBusy(true)
    try {
      const res = await window.api.technical.start({ promptText: topic.trim(), discipline: discipline.trim() || undefined })
      setSessionId(res.sessionId)
      setEntries([{ role: 'interviewer', text: res.question, citations: res.citations }])
      setDone(false)
      setPhase('live')
    } catch (err) {
      toast((err as Error).message, 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function submit(): Promise<void> {
    const text = answer.trim()
    if (!text || !sessionId) return
    setBusy(true)
    setAnswer('')
    try {
      const res = await window.api.technical.answer(sessionId, text)
      setEntries((prev) => {
        const next: Entry[] = [...prev, { role: 'candidate', text, feedback: res.feedback }]
        if (res.next_kind !== 'done' && res.next_text)
          next.push({ role: 'interviewer', text: res.next_text, citations: res.citations })
        return next
      })
      if (res.next_kind === 'done' || !res.next_text) setDone(true)
    } catch (err) {
      toast((err as Error).message, 'danger')
      setAnswer(text)
    } finally {
      setBusy(false)
    }
  }

  async function endNow(): Promise<void> {
    if (sessionId) {
      try {
        await window.api.technical.end(sessionId)
      } catch {
        // best-effort; the transcript is already persisted
      }
    }
    setDone(true)
  }

  async function copy(): Promise<void> {
    try {
      await window.api.clipboard.write(technicalToMarkdown(topic.trim(), discipline.trim(), entries))
      toast('Session copied to clipboard.', 'success')
    } catch (err) {
      toast(`Could not copy: ${(err as Error).message}`, 'danger')
    }
  }

  if (phase === 'history')
    return (
      <TechnicalHistory
        onOpen={(id) => {
          setSessionId(id)
          setPhase('transcript')
        }}
        onBack={() => setPhase('setup')}
      />
    )
  if (phase === 'transcript' && sessionId)
    return <TechnicalTranscript id={sessionId} onBack={() => setPhase('history')} />

  if (phase === 'setup') {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">Technical practice</h1>
            <p className="text-sm text-muted">Mock technical interview over your own reference material.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setPhase('history')}>
            <History className="size-4" />
            History
          </Button>
        </div>

        <Card title="Start a session">
          <div className="space-y-4">
            <label className="space-y-1">
              <span className="text-sm font-semibold text-muted">What should we drill on?</span>
              <Input
                placeholder="e.g. the rate limiter design in my notes"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void start()
                }}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-semibold text-muted">Discipline filter (optional)</span>
              <Input
                placeholder="e.g. distributed systems"
                value={discipline}
                onChange={(e) => setDiscipline(e.target.value)}
              />
            </label>
            <Button onClick={() => void start()} loading={busy} disabled={!topic.trim()}>
              Start technical interview
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-ink">Technical practice</h1>
        <div className="flex items-center gap-2">
          {entries.some((e) => e.role === 'candidate') && (
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              <Copy className="size-4" />
              Copy session
            </Button>
          )}
          {!done && (
            <Button size="sm" variant="ghost" onClick={() => void endNow()}>
              <Square className="size-4" />
              End session
            </Button>
          )}
          <Button variant="ghost" onClick={() => setPhase('setup')}>
            New session
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {entries.map((e, i) =>
          e.role === 'interviewer' ? (
            <div key={i} className="rounded-lg border border-line bg-raised p-4">
              <p className="text-sm font-semibold text-ink">{e.text}</p>
              <Citations citations={e.citations} />
            </div>
          ) : (
            <div key={i} className="space-y-2">
              <p className="whitespace-pre-wrap rounded-lg bg-canvas px-4 py-3 text-sm text-ink">{e.text}</p>
              <FeedbackGrid feedback={e.feedback} />
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      {done ? (
        <div className="space-y-3 rounded-lg border border-success/40 bg-success/10 p-4 text-sm text-ink">
          <p>That wraps this session. Start a new one to keep practicing.</p>
          <Button variant="secondary" size="sm" onClick={() => setPhase('history')}>
            <History className="size-4" />
            View history
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <Textarea
            rows={3}
            placeholder="Answer the question…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
            }}
          />
          <Button onClick={() => void submit()} loading={busy} disabled={!answer.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Answer
          </Button>
        </div>
      )}
    </div>
  )
}

function TechnicalHistory({
  onOpen,
  onBack
}: {
  onOpen: (id: string) => void
  onBack: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [sessions, setSessions] = useState<TechnicalSessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TechnicalSessionSummary | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.technical
      .list()
      .then((s) => !cancelled && setSessions(s))
      .catch((e) => !cancelled && setError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [])

  async function remove(): Promise<void> {
    if (!pendingDelete) return
    const id = pendingDelete.id
    setDeleting(true)
    try {
      await window.api.technical.remove(id)
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev))
      toast('Session deleted.', 'neutral')
      setPendingDelete(null)
    } catch (err) {
      toast(`Could not delete: ${(err as Error).message}`, 'danger')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Technical history</h1>
        <Button variant="secondary" size="sm" onClick={onBack}>
          New session
        </Button>
      </div>
      {error ? (
        <ErrorState description={error} />
      ) : sessions === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No sessions yet"
          description="Run a technical interview and it'll show up here."
        />
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 text-left hover:bg-raised"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{s.config.promptText}</span>
                  <span className="text-xs text-muted">
                    {new Date(s.started_at + 'Z').toLocaleString()} · {s.answered}{' '}
                    {s.answered === 1 ? 'answer' : 'answers'}
                    {s.config.discipline ? ` · ${s.config.discipline}` : ''}
                  </span>
                </span>
                <Badge tone={s.ended_at ? 'success' : 'warning'}>
                  {s.ended_at ? 'Complete' : 'In progress'}
                </Badge>
              </button>
              <IconButton
                label={`Delete session on ${s.config.promptText}`}
                className="shrink-0 self-center text-muted hover:text-danger"
                onClick={() => setPendingDelete(s)}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this session?"
        description="This removes the transcript and rubric for good. This can't be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  )
}

function TechnicalTranscript({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  const [session, setSession] = useState<TechnicalSession | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.technical
      .get(id)
      .then((s) => !cancelled && setSession(s))
      .catch((e) => !cancelled && setError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <button type="button" onClick={onBack} className="text-sm font-semibold text-muted hover:text-ink">
        ← Back to history
      </button>
      {error ? (
        <ErrorState description={error} />
      ) : session === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : session === null ? (
        <ErrorState title="Not found" description="This session no longer exists." />
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-bold text-ink">{session.config.promptText}</h1>
            <p className="text-sm text-muted">
              {new Date(session.started_at + 'Z').toLocaleString()}
              {session.config.discipline ? ` · ${session.config.discipline}` : ''}
            </p>
          </div>
          <ol className="space-y-4">
            {session.turns.map((t) =>
              t.role === 'interviewer' ? (
                <li key={t.id} className="rounded-lg border border-line bg-surface p-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-brand">
                    Interviewer
                  </div>
                  <p className="text-ink">{t.content}</p>
                  <Citations citations={t.citations} />
                </li>
              ) : (
                <li key={t.id} className="space-y-2 pl-4">
                  <p className="whitespace-pre-wrap text-ink">{t.content}</p>
                  {t.feedback && <FeedbackGrid feedback={t.feedback} />}
                </li>
              )
            )}
          </ol>
        </>
      )}
    </div>
  )
}
