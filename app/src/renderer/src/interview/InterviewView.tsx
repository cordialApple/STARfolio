import { useEffect, useRef, useState } from 'react'
import {
  Send,
  Sparkles,
  CheckCircle2,
  TriangleAlert,
  History,
  Inbox,
  Trash2,
  Copy,
  Download,
  Mic,
  Loader2,
  Upload,
  Search,
  X,
  Clock,
  MessageSquare
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Select,
  Skeleton,
  Textarea,
  useToast
} from '../components'
import type {
  ExperienceLevel,
  InterviewPhase,
  InterviewReport,
  InterviewSessionDetail,
  InterviewSessionSummary,
  InterviewStep,
  WhisperModelInfo,
  WhisperModelName
} from '../lib/bank-types'
import { PushToTalk } from '../practice/PushToTalk'
import { cn } from '../lib/cn'
import { debriefToMarkdown, debriefFilename, reportToMarkdown } from './debrief-markdown'
import { SAMPLE_RESUME } from './sample-resume'

type Turn = { role: 'interviewer' | 'candidate'; text: string }

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

const PHASE_LABEL: Record<InterviewPhase, string> = {
  intro: 'Warm-up',
  exploration: 'Deep dive',
  closing: 'Wrapping up',
  done: 'Complete'
}

const PHASE_STEPS: InterviewPhase[] = ['intro', 'exploration', 'closing']

const LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: 'entry', label: 'Entry level' },
  { value: 'mid', label: 'Mid level' },
  { value: 'senior', label: 'Senior' }
]

const LEVEL_LABEL: Record<ExperienceLevel, string> = {
  entry: 'Entry level',
  mid: 'Mid level',
  senior: 'Senior'
}

export function InterviewView(): React.JSX.Element {
  const [stage, setStage] = useState<'setup' | 'live' | 'history' | 'debrief'>('setup')
  const [debriefId, setDebriefId] = useState<string | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [candidateName, setCandidateName] = useState('')
  const [level, setLevel] = useState<ExperienceLevel>('mid')

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<InterviewPhase>('intro')
  const [turns, setTurns] = useState<Turn[]>([])
  const [answer, setAnswer] = useState('')
  const [report, setReport] = useState<InterviewReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [voiceModel, setVoiceModel] = useState<WhisperModelName>('base.en')
  const [models, setModels] = useState<WhisperModelInfo[]>([])
  const [dragOver, setDragOver] = useState(false)
  const resumeFileRef = useRef<HTMLInputElement>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const startedAt = useRef(0)
  const toast = useToast()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.voice.models().then(setModels)
    void window.api.prefs.get().then((p) => setVoiceModel(p.voiceModel))
    return window.api.voice.onModelStatus(setModels)
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, report, busy])

  useEffect(() => {
    if (phase !== 'intro' && phase !== 'done' && !busy && turns.at(-1)?.role === 'interviewer') {
      answerRef.current?.focus()
    }
  }, [turns, busy, phase])

  const voiceReady = models.find((m) => m.name === voiceModel)?.downloaded ?? false

  function apply(step: InterviewStep): void {
    setSessionId(step.sessionId)
    setPhase(step.phase)
    setTurns((prev) => [...prev, { role: 'interviewer', text: step.utterance }])
    if (step.report) setReport(step.report)
  }

  async function start(): Promise<void> {
    const text = resumeText.trim()
    if (!text) return
    setBusy(true)
    try {
      const step = await window.api.interview.start({
        resumeText: text,
        candidateName: candidateName.trim() || undefined,
        level
      })
      startedAt.current = Date.now()
      setTurns([])
      setReport(null)
      apply(step)
      setStage('live')
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
    setTurns((prev) => [...prev, { role: 'candidate', text }])
    try {
      const step = await window.api.interview.answer(sessionId, text, Date.now() - startedAt.current)
      apply(step)
    } catch (err) {
      toast((err as Error).message, 'danger')
      setAnswer(text)
      setTurns((prev) => prev.slice(0, -1))
    } finally {
      setBusy(false)
    }
  }

  async function loadResumeFile(file: File | undefined): Promise<void> {
    if (!file) return
    if (!/\.(txt|md|markdown)$/i.test(file.name) && !file.type.startsWith('text/')) {
      toast('Pick a .txt or .md file', 'danger')
      return
    }
    try {
      setResumeText(await file.text())
    } catch (err) {
      toast((err as Error).message, 'danger')
    }
  }

  function reset(): void {
    setStage('setup')
    setSessionId(null)
    setTurns([])
    setReport(null)
    setAnswer('')
    setPhase('intro')
  }

  if (stage === 'history')
    return (
      <HistoryList
        onOpen={(id) => {
          setDebriefId(id)
          setStage('debrief')
        }}
        onBack={() => setStage('setup')}
      />
    )

  if (stage === 'debrief' && debriefId)
    return <Debrief id={debriefId} onBack={() => setStage('history')} />

  if (stage === 'setup') {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">Mock interview</h1>
            <p className="text-sm text-muted">
              Paste your resume. An adaptive interviewer builds a roadmap from it, then walks your
              projects the way a real one would — and debriefs you at the end.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setStage('history')}>
            <History className="size-4" />
            History
          </Button>
        </div>

        <Card title="Set up your interview">
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted">
                  Resume
                  {resumeText.trim() && (
                    <span className="ml-2 font-normal tabular-nums text-faint">
                      {wordCount(resumeText)} {wordCount(resumeText) === 1 ? 'word' : 'words'}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setResumeText(SAMPLE_RESUME)}>
                    <Sparkles className="size-4" />
                    Try a sample
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => resumeFileRef.current?.click()}>
                    <Upload className="size-4" />
                    Load file
                  </Button>
                </div>
              </div>
              <input
                ref={resumeFileRef}
                type="file"
                accept=".txt,.md,.markdown,text/*"
                className="hidden"
                onChange={(e) => {
                  void loadResumeFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  void loadResumeFile(e.dataTransfer.files?.[0])
                }}
                className={cn('rounded-lg', dragOver && 'ring-2 ring-brand-strong')}
              >
                <Textarea
                  rows={10}
                  placeholder="Paste your resume, or drop a .txt/.md file here…"
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="space-y-1 block">
                <span className="text-sm font-semibold text-muted">Your name (optional)</span>
                <Input
                  placeholder="e.g. Alex"
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-sm font-semibold text-muted">Target level</span>
                <Select value={level} onChange={(e) => setLevel(e.target.value as ExperienceLevel)}>
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <Button onClick={() => void start()} loading={busy} disabled={!resumeText.trim()}>
              <Sparkles className="size-4" />
              Start interview
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  const awaitingQuestion = busy && turns.length > 0 && turns[turns.length - 1].role === 'candidate'
  const lastInterviewerIdx = turns.reduce((acc, t, i) => (t.role === 'interviewer' ? i : acc), -1)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink">Mock interview</h1>
          <LiveMeta
            startedAt={startedAt.current}
            running={phase !== 'done'}
            answered={turns.filter((t) => t.role === 'candidate').length}
          />
        </div>
        <Button variant="ghost" onClick={reset}>
          New interview
        </Button>
      </div>

      <PhaseSteps phase={phase} />

      <div className="space-y-4">
        {turns.map((t, i) =>
          t.role === 'interviewer' ? (
            <InterviewerBubble key={i} text={t.text} animate={i === lastInterviewerIdx} />
          ) : (
            <CandidateBubble key={i} text={t.text} />
          )
        )}
        {awaitingQuestion && <ThinkingBubble />}
        {report && <ReportCard report={report} />}
        <div ref={endRef} />
      </div>

      {phase === 'done' ? (
        <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm text-ink">
          That wraps the interview. Review your debrief above, or start a fresh one.
        </div>
      ) : (
        <div className="space-y-2">
          {voiceReady ? (
            <PushToTalk
              model={voiceModel}
              disabled={busy}
              onTranscript={(t) => setAnswer((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))}
              onError={(m) => toast(m, 'danger')}
            />
          ) : (
            <p className="text-xs text-muted">
              Want to speak your answers? Download a voice model in Settings → Voice.
            </p>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              ref={answerRef}
              rows={3}
              placeholder="Speak with the mic above, or type here…"
              value={answer}
              disabled={busy}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
              }}
            />
            <Button onClick={() => void submit()} loading={busy} disabled={busy || !answer.trim()}>
              <Send className="size-4" />
              Answer
            </Button>
          </div>
          <div className="flex items-center justify-between text-xs text-faint">
            <span>⌘/Ctrl + Enter to send</span>
            {answer.trim() && (
              <span className="tabular-nums">
                {wordCount(answer)} {wordCount(answer) === 1 ? 'word' : 'words'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LiveMeta({
  startedAt,
  running,
  answered
}: {
  startedAt: number
  running: boolean
  answered: number
}): React.JSX.Element {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt))
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 1000)
    return () => clearInterval(t)
  }, [startedAt, running])
  const total = Math.floor(elapsed / 1000)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return (
    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted">
      <span className="flex items-center gap-1 tabular-nums">
        <Clock className="size-3.5" />
        {mins}:{String(secs).padStart(2, '0')}
      </span>
      <span className="flex items-center gap-1">
        <MessageSquare className="size-3.5" />
        {answered} {answered === 1 ? 'answer' : 'answers'}
      </span>
    </div>
  )
}

function PhaseSteps({ phase }: { phase: InterviewPhase }): React.JSX.Element {
  const activeIdx = phase === 'done' ? PHASE_STEPS.length : PHASE_STEPS.indexOf(phase)
  return (
    <ol className="flex items-center gap-2">
      {PHASE_STEPS.map((p, i) => {
        const done = i < activeIdx
        const active = i === activeIdx
        return (
          <li key={p} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done && 'bg-brand-strong text-on-brand',
                active && 'border-2 border-brand-strong text-fg-brand',
                !done && !active && 'border border-line text-faint'
              )}
            >
              {done ? <CheckCircle2 className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                'text-xs font-medium',
                active ? 'text-ink' : done ? 'text-muted' : 'text-faint'
              )}
            >
              {PHASE_LABEL[p]}
            </span>
            {i < PHASE_STEPS.length - 1 && (
              <span className={cn('h-px flex-1', done ? 'bg-brand-strong' : 'bg-line')} />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function InterviewerBubble({
  text,
  animate
}: {
  text: string
  animate: boolean
}): React.JSX.Element {
  const [shown, setShown] = useState(animate ? '' : text)
  useEffect(() => {
    if (!animate) {
      setShown(text)
      return
    }
    setShown('')
    let i = 0
    const timer = setInterval(() => {
      i += 2
      setShown(text.slice(0, i))
      if (i >= text.length) clearInterval(timer)
    }, 16)
    return () => clearInterval(timer)
  }, [text, animate])

  return (
    <div className="rounded-lg border border-line bg-raised p-4">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-brand">
        <Mic className="size-3.5" />
        Interviewer
      </div>
      <p className="whitespace-pre-wrap text-sm font-semibold text-ink">{shown}</p>
    </div>
  )
}

function ThinkingBubble(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-raised p-4 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" />
      The interviewer is thinking…
    </div>
  )
}

function CandidateBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <p className="ml-8 whitespace-pre-wrap rounded-lg bg-canvas px-4 py-3 text-sm text-ink">{text}</p>
  )
}

function starStoryToText(story: InterviewReport['starStories'][number]): string {
  const rows: [string, string][] = [
    ['Situation', story.situation],
    ['Task', story.task],
    ['Action', story.action],
    ['Result', story.result]
  ]
  return [story.topic, ...rows.filter(([, v]) => v.trim()).map(([k, v]) => `${k}: ${v}`)].join('\n')
}

function ReportCard({ report }: { report: InterviewReport }): React.JSX.Element {
  const toast = useToast()

  async function copy(text: string, label: string): Promise<void> {
    try {
      await window.api.clipboard.write(text)
      toast(`${label} copied to clipboard.`, 'success')
    } catch (err) {
      toast(`Could not copy: ${(err as Error).message}`, 'danger')
    }
  }

  return (
    <Card
      title="Your debrief"
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void copy(reportToMarkdown(report), 'Feedback')}
        >
          <Copy className="size-3.5" />
          Copy feedback
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-ink">{report.overallFeedback}</p>

        <Section
          icon={<CheckCircle2 className="size-4 text-success" />}
          title="Strengths"
          items={report.strengths}
        />

        <Section
          icon={<TriangleAlert className="size-4 text-warning" />}
          title="Areas to improve"
          items={report.improvementAreas}
        />

        {report.starStories.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">STAR stories from your answers</h3>
              {report.starStories.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void copy(report.starStories.map(starStoryToText).join('\n\n'), 'All STAR stories')
                  }
                >
                  <Copy className="size-3.5" />
                  Copy all
                </Button>
              )}
            </div>
            {report.starStories.map((story, i) => (
              <div key={i} className="rounded-lg border border-line p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{story.topic}</p>
                  <IconButton
                    label={`Copy STAR story: ${story.topic}`}
                    className="shrink-0 text-muted hover:text-ink"
                    onClick={() => void copy(starStoryToText(story), 'STAR story')}
                  >
                    <Copy className="size-4" />
                  </IconButton>
                </div>
                <dl className="space-y-1 text-sm">
                  <StarRow label="Situation" value={story.situation} />
                  <StarRow label="Task" value={story.task} />
                  <StarRow label="Action" value={story.action} />
                  <StarRow label="Result" value={story.result} />
                </dl>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function Section({
  icon,
  title,
  items
}: {
  icon: React.ReactNode
  title: string
  items: string[]
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {icon}
        {title}
      </h3>
      <ul className="ml-6 list-disc space-y-1 text-sm text-muted">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function StarRow({ label, value }: { label: string; value: string }): React.JSX.Element | null {
  if (!value.trim()) return null
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 font-semibold text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
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
  const [sessions, setSessions] = useState<InterviewSessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<InterviewSessionSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'done' | 'active'>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')

  useEffect(() => {
    let cancelled = false
    void window.api.interview
      .list()
      .then((s) => !cancelled && setSessions(s))
      .catch((e) => !cancelled && setError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [])

  const needle = query.trim().toLowerCase()
  const visible = (sessions ?? []).filter((s) => {
    const name = (s.candidateName ?? 'Anonymous candidate').toLowerCase()
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'done' ? s.phase === 'done' : s.phase !== 'done')
    return matchesStatus && name.includes(needle)
  })
  visible.sort((a, b) =>
    sort === 'newest' ? b.startedAt.localeCompare(a.startedAt) : a.startedAt.localeCompare(b.startedAt)
  )

  async function remove(): Promise<void> {
    if (!pendingDelete) return
    const id = pendingDelete.id
    setDeleting(true)
    try {
      await window.api.interview.remove(id)
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev))
      toast('Interview deleted.', 'neutral')
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
        <h1 className="text-2xl font-bold text-ink">Interview history</h1>
        <Button variant="secondary" size="sm" onClick={onBack}>
          New interview
        </Button>
      </div>
      {sessions !== null && sessions.length > 0 && (
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              className={cn('pl-9', query && 'pr-9')}
              placeholder="Search by name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <IconButton
                label="Clear search"
                className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-faint hover:text-ink"
                onClick={() => setQuery('')}
              >
                <X className="size-4" />
              </IconButton>
            )}
          </div>
          <Select
            className="w-40 shrink-0"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">All</option>
            <option value="done">Complete</option>
            <option value="active">In progress</option>
          </Select>
          <Select
            className="w-36 shrink-0"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </Select>
        </div>
      )}
      {sessions !== null && sessions.length > 0 && (
        <p className="text-xs text-muted">
          {visible.length === sessions.length
            ? `${sessions.length} ${sessions.length === 1 ? 'interview' : 'interviews'}`
            : `${visible.length} of ${sessions.length} interviews`}
        </p>
      )}
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
          title="No interviews yet"
          description="Run a mock interview and it'll show up here."
        />
      ) : visible.length === 0 ? (
        <EmptyState icon={Inbox} title="No matches" description="No interviews match your search." />
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => (
            <li key={s.id} className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 text-left hover:bg-raised"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">
                    {s.candidateName ?? 'Anonymous candidate'}
                  </span>
                  <span className="text-xs text-muted">
                    {new Date(s.startedAt + 'Z').toLocaleString()} · {LEVEL_LABEL[s.level]} ·{' '}
                    {s.turnCount} {s.turnCount === 1 ? 'turn' : 'turns'}
                  </span>
                </span>
                <Badge tone={s.phase === 'done' ? 'success' : 'warning'}>
                  {s.phase === 'done' ? 'Complete' : 'In progress'}
                </Badge>
              </button>
              <IconButton
                label={`Delete interview with ${s.candidateName ?? 'anonymous candidate'}`}
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
        title="Delete this interview?"
        description="This removes the transcript and debrief for good. This can't be undone."
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

function Debrief({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  const [detail, setDetail] = useState<InterviewSessionDetail | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'md' | 'docx' | null>(null)
  const toast = useToast()

  async function copy(): Promise<void> {
    if (!detail) return
    try {
      await window.api.clipboard.write(debriefToMarkdown(detail))
      toast('Debrief copied to clipboard.', 'success')
    } catch (err) {
      toast(`Could not copy: ${(err as Error).message}`, 'danger')
    }
  }

  async function exportAs(format: 'md' | 'docx'): Promise<void> {
    if (!detail) return
    setBusy(format)
    try {
      const res = await window.api.materials.export(
        debriefToMarkdown(detail),
        format,
        debriefFilename(detail)
      )
      if (res.saved) toast(`Saved to ${res.path}`, 'success')
    } catch (err) {
      toast(`Could not export: ${(err as Error).message}`, 'danger')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    void window.api.interview
      .get(id)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-semibold text-muted hover:text-ink"
        >
          ← Back to history
        </button>
        {detail && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              <Copy className="size-4" />
              Copy debrief
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void exportAs('md')}
              loading={busy === 'md'}
            >
              <Download className="size-4" />
              Export .md
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void exportAs('docx')}
              loading={busy === 'docx'}
            >
              <Download className="size-4" />
              Export .docx
            </Button>
          </div>
        )}
      </div>
      {error ? (
        <ErrorState description={error} />
      ) : detail === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : detail === null ? (
        <ErrorState title="Not found" description="This interview no longer exists." />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-ink">
              {detail.candidateName ?? 'Anonymous candidate'}
            </h1>
            <Badge tone={detail.phase === 'done' ? 'success' : 'neutral'}>
              {PHASE_LABEL[detail.phase]}
            </Badge>
          </div>
          <p className="text-sm text-muted">
            {new Date(detail.startedAt + 'Z').toLocaleString()} · {LEVEL_LABEL[detail.level]}
          </p>
          <div className="space-y-4">
            {detail.transcript.map((t, i) =>
              t.speaker === 'interviewer' ? (
                <div key={i} className="rounded-lg border border-line bg-raised p-4">
                  <p className="whitespace-pre-wrap text-sm font-semibold text-ink">{t.text}</p>
                </div>
              ) : (
                <CandidateBubble key={i} text={t.text} />
              )
            )}
          </div>
          {detail.report && <ReportCard report={detail.report} />}
        </>
      )}
    </div>
  )
}
