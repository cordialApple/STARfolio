import { useEffect, useRef, useState } from 'react'
import {
  Mic,
  Send,
  Square,
  History,
  Plus,
  Sparkles,
  Inbox,
  Volume2,
  Check,
  Loader2,
  Trash2
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  Select,
  Skeleton,
  Textarea,
  Toggle,
  useToast
} from '../components'
import type {
  InterviewFeedback,
  PracticeConfig,
  PracticeKind,
  PracticeSession,
  PracticeSessionSummary,
  WhisperModelInfo,
  WhisperModelName,
  StoryMatch
} from '../lib/bank-types'
import { FeedbackCard } from './FeedbackCard'
import { PushToTalk } from './PushToTalk'
import { speak, stopSpeaking, ttsAvailable } from '../lib/tts'
import { cn } from '../lib/cn'

// Mirror of STORY_MATCH_THRESHOLD in the main-process search module: above this cosine similarity
// the spoken answer is treated as already being that banked story.
const MATCH_THRESHOLD = 0.8

const THEMES = [
  'Leadership',
  'Problem solving',
  'Teamwork',
  'Conflict',
  'Handling failure',
  'Working under pressure'
]

interface LiveTurn {
  role: 'interviewer' | 'candidate'
  text: string
  feedback?: InterviewFeedback
  used?: { id: string; title: string }[]
  matchChecked?: boolean
  match?: StoryMatch | null
  captured?: boolean
}

type View = 'setup' | 'live' | 'history' | 'transcript'

export function PracticeView(): React.JSX.Element {
  const toast = useToast()
  const [view, setView] = useState<View>('setup')

  const [mode, setMode] = useState<PracticeKind>('genre')
  const [jd, setJd] = useState('')
  const [theme, setTheme] = useState(THEMES[0])
  const [starting, setStarting] = useState(false)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turns, setTurns] = useState<LiveTurn[]>([])
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [ended, setEnded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [voiceModel, setVoiceModel] = useState<WhisperModelName>('base.en')
  const [models, setModels] = useState<WhisperModelInfo[]>([])
  const [tts, setTts] = useState(false)

  useEffect(() => {
    void window.api.voice.models().then(setModels)
    void window.api.prefs.get().then((p) => setVoiceModel(p.voiceModel))
    return window.api.voice.onModelStatus(setModels)
  }, [])
  useEffect(() => () => stopSpeaking(), [])
  // Stop any in-flight question read-aloud when leaving the live interview for another view.
  useEffect(() => {
    if (view !== 'live') stopSpeaking()
  }, [view])

  const voiceReady = models.find((m) => m.name === voiceModel)?.downloaded ?? false

  function say(text: string): void {
    if (tts) speak(text)
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns.length, busy])

  async function start(): Promise<void> {
    const promptText = mode === 'jd' ? jd.trim() : theme
    if (!promptText) return
    setStarting(true)
    setError(null)
    try {
      const config: PracticeConfig = { kind: mode, promptText }
      const { sessionId: id, question } = await window.api.practice.start(config)
      setSessionId(id)
      setTurns([{ role: 'interviewer', text: question }])
      setEnded(false)
      setView('live')
      say(question)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setStarting(false)
    }
  }

  // Background semantic check: is this spoken answer already one of the banked stories? Runs after
  // the feedback shows so it never blocks the interview; the capture banner appears when it resolves.
  async function checkMatch(idx: number, text: string): Promise<void> {
    let match: StoryMatch | null = null
    try {
      match = await window.api.bank.matchStory(text)
    } catch {
      match = null
    }
    setTurns((t) => t.map((turn, i) => (i === idx ? { ...turn, matchChecked: true, match } : turn)))
  }

  async function submit(): Promise<void> {
    const text = answer.trim()
    if (!text || !sessionId) return
    setBusy(true)
    setError(null)
    let candidateIdx = 0
    setTurns((t) => {
      candidateIdx = t.length
      return [...t, { role: 'candidate', text }]
    })
    setAnswer('')
    try {
      const res = await window.api.practice.answer(sessionId, text)
      setTurns((t) => {
        const copy = [...t]
        copy[candidateIdx] = {
          role: 'candidate',
          text,
          feedback: res.feedback,
          used: res.used,
          matchChecked: false
        }
        if (res.next_kind !== 'done' && res.next_text)
          copy.push({ role: 'interviewer', text: res.next_text })
        return copy
      })
      if (res.next_kind === 'done') {
        setEnded(true)
        toast('Session complete — nice work.', 'success')
      } else if (res.next_text) {
        say(res.next_text)
      }
      void checkMatch(candidateIdx, text)
    } catch (err) {
      setError((err as Error).message)
      setTurns((t) => t.slice(0, -1))
      setAnswer(text)
    } finally {
      setBusy(false)
    }
  }

  const [capturingIdx, setCapturingIdx] = useState<number | null>(null)
  async function captureToBank(idx: number, text: string): Promise<void> {
    setCapturingIdx(idx)
    try {
      // Re-check right before saving so we don't create a duplicate of a story banked meanwhile.
      const dup = await window.api.bank.matchStory(text)
      if (dup && dup.similarity >= MATCH_THRESHOLD) {
        setTurns((t) => t.map((turn, i) => (i === idx ? { ...turn, match: dup } : turn)))
        toast(`This looks like your existing “${dup.title}.” Skipped to avoid a duplicate.`, 'neutral')
        return
      }
      const ext = await window.api.brain.extract(text)
      await window.api.bank.create({
        title: ext.title,
        situation: ext.situation.text,
        task: ext.task.text,
        action: ext.action.text,
        result_text: ext.result.text,
        context: ext.context,
        happened_start: null,
        happened_end: null,
        status: 'draft',
        skills: ext.skills,
        tags: ext.tags,
        metrics: ext.metrics,
        source: { kind: 'paste', raw_text: text }
      })
      setTurns((t) => t.map((turn, i) => (i === idx ? { ...turn, captured: true } : turn)))
      toast('Saved to your bank as a draft — polish it in the Bank tab.', 'success')
    } catch (err) {
      toast(`Could not capture: ${(err as Error).message}`, 'danger')
    } finally {
      setCapturingIdx(null)
    }
  }

  async function endNow(): Promise<void> {
    stopSpeaking()
    if (sessionId) {
      try {
        await window.api.practice.end(sessionId)
      } catch {
        // best-effort; the transcript is already persisted
      }
    }
    setEnded(true)
  }

  function captureBanner(t: LiveTurn, i: number): React.JSX.Element | null {
    if (t.captured)
      return (
        <p className="flex items-center gap-1.5 rounded-lg bg-success/15 px-3 py-1.5 text-xs font-medium text-fg-success">
          <Check className="size-3.5" />
          Saved to your bank as a draft.
        </p>
      )
    if (!t.matchChecked)
      return (
        <p className="flex items-center gap-1.5 px-1 text-xs text-faint">
          <Loader2 className="size-3.5 animate-spin" />
          Checking your bank…
        </p>
      )
    if (t.match && t.match.similarity >= MATCH_THRESHOLD)
      return (
        <p className="flex items-center gap-1.5 px-1 text-xs text-muted">
          <Check className="size-3.5 text-fg-success" />
          Already in your bank as &ldquo;{t.match.title}.&rdquo;
        </p>
      )
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning/15 px-3 py-2 text-xs font-medium text-fg-warning">
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3.5" />
          Not in your bank yet.
          {t.match && ` (closest: “${t.match.title}”)`}
        </span>
        <Button
          size="sm"
          variant="secondary"
          loading={capturingIdx === i}
          disabled={capturingIdx !== null}
          onClick={() => void captureToBank(i, t.text)}
        >
          <Sparkles className="size-3.5" />
          Capture it
        </Button>
      </div>
    )
  }

  if (view === 'history') return <HistoryList onOpen={(id) => { setSessionId(id); setView('transcript') }} onBack={() => setView('setup')} />
  if (view === 'transcript' && sessionId)
    return <Transcript id={sessionId} onBack={() => setView('history')} />

  if (view === 'live')
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-ink">Mock interview</h1>
          <div className="flex items-center gap-3">
            {ttsAvailable() && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <Volume2 className="size-4" />
                Read aloud
                <Toggle
                  label="Read interviewer questions aloud"
                  checked={tts}
                  onCheckedChange={(on) => {
                    setTts(on)
                    if (!on) stopSpeaking()
                  }}
                />
              </span>
            )}
            {!ended && (
              <Button variant="ghost" size="sm" onClick={() => void endNow()}>
                <Square className="size-4" />
                End session
              </Button>
            )}
          </div>
        </div>

        <ol className="space-y-4">
          {turns.map((t, i) =>
            t.role === 'interviewer' ? (
              <li key={i} className="rounded-lg border border-line bg-surface p-4">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-brand">
                  <Mic className="size-3.5" />
                  Interviewer
                </div>
                <p className="text-ink">{t.text}</p>
              </li>
            ) : (
              <li key={i} className="space-y-2 pl-4">
                <p className="whitespace-pre-wrap text-ink">{t.text}</p>
                {t.feedback && <FeedbackCard feedback={t.feedback} />}
                {t.used && t.used.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    Drew on:
                    {t.used.map((u) => (
                      <span key={u.id} className="rounded-pill bg-raised px-2 py-0.5 font-medium">
                        {u.title}
                      </span>
                    ))}
                  </p>
                )}
                {t.feedback && captureBanner(t, i)}
              </li>
            )
          )}
        </ol>

        {error && <ErrorState description={error} />}

        {ended ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setView('setup')}>
              <Plus className="size-4" />
              New session
            </Button>
            <Button variant="secondary" onClick={() => setView('history')}>
              <History className="size-4" />
              Review sessions
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {voiceReady ? (
              <PushToTalk
                model={voiceModel}
                disabled={busy}
                onTranscript={(t) =>
                  setAnswer((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))
                }
                onError={setError}
              />
            ) : (
              <p className="text-xs text-muted">
                Want to speak your answers? Download a voice model in Settings → Voice.
              </p>
            )}
            <Textarea
              rows={4}
              value={answer}
              disabled={busy}
              placeholder="Speak with the mic above, or type here — edit freely before sending…"
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-faint">⌘/Ctrl + Enter to send</span>
              <Button loading={busy} disabled={busy || !answer.trim()} onClick={() => void submit()}>
                <Send className="size-4" />
                Answer
              </Button>
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>
    )

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Practice</h1>
          <p className="text-sm text-muted">
            A live mock interview — pointed questions, honest feedback, sharp follow-ups.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setView('history')}>
          <History className="size-4" />
          History
        </Button>
      </div>

      <Card title="Set up your session">
        <div className="space-y-4">
          <div className="inline-flex rounded-lg border border-line p-0.5">
            <TabButton active={mode === 'genre'} onClick={() => setMode('genre')}>
              By theme
            </TabButton>
            <TabButton active={mode === 'jd'} onClick={() => setMode('jd')}>
              For a job description
            </TabButton>
          </div>

          {mode === 'genre' ? (
            <label className="block space-y-1 text-sm">
              <span className="font-semibold text-muted">Theme</span>
              <Select value={theme} onChange={(e) => setTheme(e.target.value)}>
                {THEMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <Textarea
              rows={5}
              value={jd}
              placeholder="Paste the job description you're interviewing for…"
              onChange={(e) => setJd(e.target.value)}
            />
          )}

          {error && <ErrorState description={error} />}

          <div className="flex justify-end">
            <Button
              loading={starting}
              disabled={starting || (mode === 'jd' && !jd.trim())}
              onClick={() => void start()}
            >
              <Mic className="size-4" />
              Start interview
            </Button>
          </div>
        </div>
      </Card>
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

function HistoryList({
  onOpen,
  onBack
}: {
  onOpen: (id: string) => void
  onBack: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [sessions, setSessions] = useState<PracticeSessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PracticeSessionSummary | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.practice
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
      await window.api.practice.remove(id)
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
        <h1 className="text-2xl font-bold text-ink">Session history</h1>
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
        <EmptyState icon={Inbox} title="No sessions yet" description="Run a mock interview and it'll show up here." />
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
        description="This removes the transcript and feedback for good. This can't be undone."
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

function Transcript({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  const [session, setSession] = useState<PracticeSession | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.practice
      .get(id)
      .then((s) => !cancelled && setSession(s))
      .catch((e) => !cancelled && setError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-semibold text-muted hover:text-ink"
      >
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
            <p className="text-sm text-muted">{new Date(session.started_at + 'Z').toLocaleString()}</p>
          </div>
          <ol className="space-y-4">
            {session.turns.map((t) =>
              t.role === 'interviewer' ? (
                <li key={t.id} className="rounded-lg border border-line bg-surface p-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-brand">
                    Interviewer
                  </div>
                  <p className="text-ink">{t.content}</p>
                </li>
              ) : (
                <li key={t.id} className="space-y-2 pl-4">
                  <p className="whitespace-pre-wrap text-ink">{t.content}</p>
                  {t.feedback && <FeedbackCard feedback={t.feedback} />}
                  {t.experiences.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      Drew on:
                      {t.experiences.map((u) => (
                        <span key={u.id} className="rounded-pill bg-raised px-2 py-0.5 font-medium">
                          {u.title}
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              )
            )}
          </ol>
        </>
      )}
    </div>
  )
}
