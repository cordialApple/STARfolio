import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, FileText, Link2, Loader2, Send, Trash2, Quote } from 'lucide-react'
import { Badge, Button, Card, Input, Textarea, useToast } from '../components'
import type {
  Citation,
  CorpusDocSummary,
  TechnicalFeedback,
  TechnicalRubricDimension
} from '../lib/bank-types'

type Entry =
  | { role: 'interviewer'; text: string; citations: Citation[] }
  | { role: 'candidate'; text: string; feedback: TechnicalFeedback }

const DIMS: { key: TechnicalRubricDimension; label: string }[] = [
  { key: 'correctness', label: 'Correctness' },
  { key: 'depth', label: 'Depth' },
  { key: 'tradeoffs', label: 'Trade-offs' },
  { key: 'communication', label: 'Communication' }
]

function scoreTone(score: number): 'success' | 'warning' | 'danger' {
  return score >= 4 ? 'success' : score === 3 ? 'warning' : 'danger'
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

function CorpusManager({ onChanged }: { onChanged: () => void }): React.JSX.Element {
  const [docs, setDocs] = useState<CorpusDocSummary[] | null>(null)
  const [discipline, setDiscipline] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()

  const refresh = useCallback((): void => {
    void window.api.corpus.list().then(setDocs)
  }, [])
  useEffect(() => refresh(), [refresh])

  async function addFiles(): Promise<void> {
    const paths = await window.api.ingest.pickFiles()
    if (paths.length === 0) return
    setBusy('files')
    try {
      const results = await window.api.corpus.addFiles(paths, discipline)
      const added = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok)
      if (added > 0) toast(`Added ${added} document${added === 1 ? '' : 's'} to your corpus.`, 'success')
      for (const f of failed) toast(`${f.name}: ${f.error}`, 'danger')
      refresh()
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  async function addUrl(): Promise<void> {
    if (!url.trim()) return
    setBusy('url')
    try {
      const r = await window.api.corpus.addUrl(url.trim(), discipline)
      if (r.ok) {
        toast('Added to your corpus.', 'success')
        setUrl('')
        refresh()
        onChanged()
      } else toast(r.error ?? 'Could not add that page.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string): Promise<void> {
    await window.api.corpus.remove(id)
    refresh()
    onChanged()
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <BookOpen className="size-4" />
          Reference corpus
        </span>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Add your own system-design notes, docs, or write-ups. Technical practice draws its questions
          from this material and cites the exact passages.
        </p>
        <Input
          placeholder="Discipline for what you add next (optional, e.g. distributed systems)"
          value={discipline}
          onChange={(e) => setDiscipline(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void addFiles()} loading={busy === 'files'}>
            <FileText className="size-4" />
            Add files
          </Button>
          <div className="flex flex-1 gap-2">
            <Input
              type="url"
              placeholder="https://example.com/a-design-doc"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addUrl()
              }}
            />
            <Button onClick={() => void addUrl()} loading={busy === 'url'} disabled={!url.trim()}>
              <Link2 className="size-4" />
              Add
            </Button>
          </div>
        </div>

        {docs && docs.length > 0 && (
          <ul className="space-y-2">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-line bg-raised p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{d.title}</div>
                  <div className="text-xs text-faint">
                    {d.discipline ? `${d.discipline} · ` : ''}
                    {d.chunks} chunk{d.chunks === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(d.id)}
                  className="shrink-0 text-faint hover:text-fg-danger"
                  aria-label={`Remove ${d.title}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

export function TechnicalView(): React.JSX.Element {
  const [phase, setPhase] = useState<'setup' | 'live'>('setup')
  const [topic, setTopic] = useState('')
  const [discipline, setDiscipline] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [corpusToken, setCorpusToken] = useState(0)
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

  if (phase === 'setup') {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Technical practice</h1>
          <p className="text-sm text-muted">Mock technical interview over your own reference material.</p>
        </div>

        <CorpusManager onChanged={() => setCorpusToken((n) => n + 1)} />

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
            <p className="text-xs text-faint" data-corpus-token={corpusToken}>
              Every question is drawn from — and cites — the corpus above.
            </p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-ink">Technical practice</h1>
        <Button variant="ghost" onClick={() => setPhase('setup')}>
          New session
        </Button>
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
              <div className="rounded-lg border border-line p-3">
                <div className="grid grid-cols-2 gap-2">
                  {DIMS.map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted">{label}</span>
                      <Badge tone={scoreTone(e.feedback[key].score)}>{e.feedback[key].score}/5</Badge>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-sm text-ink">{e.feedback.summary}</p>
              </div>
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      {done ? (
        <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm text-ink">
          That wraps this session. Start a new one to keep practicing.
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
