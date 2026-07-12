import { useEffect, useState } from 'react'
import { ArrowLeft, FileText, FolderGit2, GitBranch, Link2, Loader2, Upload, AlertTriangle } from 'lucide-react'
import { Button, Input, useToast } from '../components'
import { StarForm, type StarSeed } from '../capture/StarForm'
import type { EntityInput, EvidenceKind, IngestResult, Skill, StarExtraction, Tag } from '../lib/bank-types'

export interface ImportWizardProps {
  skills: Skill[]
  tags: Tag[]
  onExit: () => void
  onSaved: (id: string) => void
}

interface ReviewItem {
  seed: StarSeed
  sourceName: string
  entities: EntityInput[]
}

const EVIDENCE_KINDS = new Set(['spreadsheet', 'code', 'repo'])
const ekey = (e: EntityInput): string => `${e.kind}:${e.name}`

function seedFrom(ext: StarExtraction, sourceId: string): StarSeed {
  return {
    values: {
      title: ext.title,
      situation: ext.situation.text,
      task: ext.task.text,
      action: ext.action.text,
      result_text: ext.result.text,
      context: ext.context,
      skills: ext.skills,
      tags: ext.tags,
      metrics: ext.metrics
    },
    sourceId,
    gaps: ext.gaps,
    confidence: {
      situation: ext.situation.confidence,
      task: ext.task.confidence,
      action: ext.action.confidence,
      result_text: ext.result.confidence
    }
  }
}

export function ImportWizard({ skills, tags, onExit, onSaved }: ImportWizardProps): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [resumeMode, setResumeMode] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [notes, setNotes] = useState<IngestResult[]>([])
  const [review, setReview] = useState<ReviewItem[]>([])
  const [cursor, setCursor] = useState(0)
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const toast = useToast()

  useEffect(() => {
    if (review[cursor]) setApproved(new Set(review[cursor].entities.map(ekey)))
  }, [cursor, review])

  async function extractSources(results: IngestResult[]): Promise<void> {
    const problems = results.filter((r) => !r.ok || r.duplicate)
    const fresh = results.filter((r) => r.ok && !r.duplicate && r.source)
    setNotes(problems)
    if (fresh.length === 0) {
      if (problems.length === 0) toast('Nothing to import.', 'neutral')
      setBusy(null)
      return
    }
    try {
      const items: ReviewItem[] = []
      for (const r of fresh) {
        const src = r.source!
        const raw = src.raw_text ?? ''
        const name = src.title ?? r.name
        if (EVIDENCE_KINDS.has(src.kind)) {
          const [ext, ents] = await Promise.all([
            window.api.evidence.extract(raw, src.kind as EvidenceKind),
            window.api.entity.extract(raw)
          ])
          items.push({ seed: seedFrom(ext, src.id), sourceName: name, entities: ents.entities })
        } else {
          const exts = resumeMode
            ? await window.api.resume.extract(raw)
            : [await window.api.brain.extract(raw)]
          for (const ext of exts) items.push({ seed: seedFrom(ext, src.id), sourceName: name, entities: [] })
        }
      }
      if (items.length === 0) {
        toast('Could not pull any experiences from those sources.', 'danger')
        setBusy(null)
        return
      }
      setReview(items)
      setCursor(0)
    } catch (err) {
      toast(`Extraction failed: ${(err as Error).message}`, 'danger')
    } finally {
      setBusy(null)
    }
  }

  async function run(kind: string, fn: () => Promise<IngestResult[]>): Promise<void> {
    setBusy(kind)
    try {
      await extractSources(await fn())
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, 'danger')
      setBusy(null)
    }
  }

  async function importPaths(paths: string[]): Promise<void> {
    if (paths.length > 0) await run('files', () => window.api.ingest.files(paths))
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault()
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => window.api.ingest.pathForFile(f))
    void importPaths(paths.filter(Boolean))
  }

  async function pickFolder(): Promise<void> {
    const path = await window.api.ingest.pickFolder()
    if (path) await run('folder', async () => [await window.api.ingest.codeFolder(path)])
  }

  if (review.length > 0 && cursor < review.length) {
    const item = review[cursor]
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <span className="text-sm font-semibold text-muted">
          Reviewing {cursor + 1} of {review.length} — {item.sourceName}
        </span>
        {item.entities.length > 0 && (
          <div className="rounded-lg border border-line bg-raised p-3">
            <p className="mb-2 text-sm font-semibold text-ink">Connections found — approve what to keep</p>
            <div className="flex flex-wrap gap-1.5">
              {item.entities.map((e) => {
                const on = approved.has(ekey(e))
                return (
                  <button
                    key={ekey(e)}
                    type="button"
                    onClick={() =>
                      setApproved((prev) => {
                        const next = new Set(prev)
                        if (next.has(ekey(e))) next.delete(ekey(e))
                        else next.add(ekey(e))
                        return next
                      })
                    }
                    className={`rounded-pill px-2.5 py-0.5 text-xs font-medium ${
                      on ? 'bg-fg-brand/15 text-fg-brand' : 'bg-canvas text-faint line-through'
                    }`}
                  >
                    {e.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <StarForm
          key={cursor}
          seed={item.seed}
          skills={skills}
          tags={tags}
          onCancel={() => (cursor + 1 < review.length ? setCursor((c) => c + 1) : onExit())}
          onSaved={async (exp) => {
            const keep = item.entities.filter((e) => approved.has(ekey(e)))
            if (keep.length > 0) await window.api.graph.link(exp.id, keep)
            if (cursor + 1 < review.length) setCursor((c) => c + 1)
            else onSaved(exp.id)
          }}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <button
        type="button"
        onClick={onExit}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Back to bank
      </button>

      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">Import</h1>
        <p className="mt-1 text-sm text-muted">
          Bring in a resume, notes, a spreadsheet, or a whole codebase. We pull a STAR draft and keep the
          source attached.
        </p>
      </div>

      <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={resumeMode}
          onChange={(e) => setResumeMode(e.target.checked)}
          className="size-4 accent-fg-brand"
        />
        These are resumes — split each into multiple experiences
      </label>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? 'border-fg-brand bg-raised' : 'border-line'
        }`}
      >
        <Upload className="size-6 text-faint" />
        <p className="text-sm text-muted">Drop pdf, docx, txt, md, xlsx, csv, or zip files here</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={() => void run('files', async () => window.api.ingest.files(await window.api.ingest.pickFiles()))} loading={busy === 'files'}>
            <FileText className="size-4" />
            Choose files
          </Button>
          <Button variant="secondary" onClick={() => void pickFolder()} loading={busy === 'folder'}>
            <FolderGit2 className="size-4" />
            Choose a code folder
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="import-url" className="text-sm font-semibold text-ink">
          Import a web page
        </label>
        <div className="flex gap-2">
          <Input
            id="import-url"
            type="url"
            placeholder="https://example.com/a-write-up"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.trim()) void run('url', async () => [await window.api.ingest.url(url.trim())])
            }}
          />
          <Button onClick={() => void run('url', async () => [await window.api.ingest.url(url.trim())])} loading={busy === 'url'} disabled={!url.trim()}>
            <Link2 className="size-4" />
            Import
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="import-repo" className="text-sm font-semibold text-ink">
          Import a GitHub repository
        </label>
        <div className="flex gap-2">
          <Input
            id="import-repo"
            type="url"
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && repoUrl.trim()) void run('repo', async () => [await window.api.ingest.repo(repoUrl.trim())])
            }}
          />
          <Button onClick={() => void run('repo', async () => [await window.api.ingest.repo(repoUrl.trim())])} loading={busy === 'repo'} disabled={!repoUrl.trim()}>
            <GitBranch className="size-4" />
            Import
          </Button>
        </div>
        <p className="text-xs text-faint">Private repos need a GitHub token — add one in Settings.</p>
      </div>

      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          Reading and extracting…
        </p>
      )}

      {notes.length > 0 && (
        <ul className="space-y-2">
          {notes.map((n, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-ink"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-fg-warning" />
              <span>
                <span className="font-semibold">{n.name}</span> —{' '}
                {n.duplicate ? 'already in your bank; skipped.' : n.error}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
