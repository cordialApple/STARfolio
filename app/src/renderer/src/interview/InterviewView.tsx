import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles, CheckCircle2, TriangleAlert, History, Inbox } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
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
  InterviewStep
} from '../lib/bank-types'

type Turn = { role: 'interviewer' | 'candidate'; text: string }

const PHASE_LABEL: Record<InterviewPhase, string> = {
  intro: 'Warm-up',
  exploration: 'Deep dive',
  closing: 'Wrapping up',
  done: 'Complete'
}

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
  const startedAt = useRef(0)
  const toast = useToast()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, report])

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
            <label className="space-y-1 block">
              <span className="text-sm font-semibold text-muted">Resume</span>
              <Textarea
                rows={10}
                placeholder="Paste your resume text here…"
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
              />
            </label>
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

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-ink">Mock interview</h1>
          <Badge tone={phase === 'done' ? 'success' : 'neutral'}>{PHASE_LABEL[phase]}</Badge>
        </div>
        <Button variant="ghost" onClick={reset}>
          New interview
        </Button>
      </div>

      <div className="space-y-4">
        {turns.map((t, i) =>
          t.role === 'interviewer' ? (
            <div key={i} className="rounded-lg border border-line bg-raised p-4">
              <p className="whitespace-pre-wrap text-sm font-semibold text-ink">{t.text}</p>
            </div>
          ) : (
            <p
              key={i}
              className="ml-8 whitespace-pre-wrap rounded-lg bg-canvas px-4 py-3 text-sm text-ink"
            >
              {t.text}
            </p>
          )
        )}
        {report && <ReportCard report={report} />}
        <div ref={endRef} />
      </div>

      {phase === 'done' ? (
        <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm text-ink">
          That wraps the interview. Review your debrief above, or start a fresh one.
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <Textarea
            rows={3}
            placeholder="Type your answer…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
            }}
          />
          <Button onClick={() => void submit()} loading={busy} disabled={!answer.trim()}>
            <Send className="size-4" />
            Answer
          </Button>
        </div>
      )}
    </div>
  )
}

function ReportCard({ report }: { report: InterviewReport }): React.JSX.Element {
  return (
    <Card title="Your debrief">
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
            <h3 className="text-sm font-semibold text-ink">STAR stories from your answers</h3>
            {report.starStories.map((story, i) => (
              <div key={i} className="rounded-lg border border-line p-3">
                <p className="mb-2 text-sm font-semibold text-ink">{story.topic}</p>
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
  const [sessions, setSessions] = useState<InterviewSessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Interview history</h1>
        <Button variant="secondary" size="sm" onClick={onBack}>
          New interview
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
          title="No interviews yet"
          description="Run a mock interview and it'll show up here."
        />
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 text-left hover:bg-raised"
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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Debrief({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  const [detail, setDetail] = useState<InterviewSessionDetail | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

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
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-semibold text-muted hover:text-ink"
      >
        ← Back to history
      </button>
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
                <p
                  key={i}
                  className="ml-8 whitespace-pre-wrap rounded-lg bg-canvas px-4 py-3 text-sm text-ink"
                >
                  {t.text}
                </p>
              )
            )}
          </div>
          {detail.report && <ReportCard report={detail.report} />}
        </>
      )}
    </div>
  )
}
