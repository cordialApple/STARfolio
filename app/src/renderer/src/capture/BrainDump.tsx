import { useState } from 'react'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { Button, Textarea, ErrorState } from '../components'
import type { Skill, StarExtraction, Tag } from '../lib/bank-types'
import { StarForm, type StarSeed } from './StarForm'

function toSeed(ext: StarExtraction, rawText: string): StarSeed {
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
    source: { kind: 'paste', raw_text: rawText },
    gaps: ext.gaps,
    confidence: {
      situation: ext.situation.confidence,
      task: ext.task.confidence,
      action: ext.action.confidence,
      result_text: ext.result.confidence
    }
  }
}

export interface BrainDumpProps {
  skills: Skill[]
  tags: Tag[]
  onSaved: (id: string) => void
  onExit: () => void
}

export function BrainDump({ skills, tags, onSaved, onExit }: BrainDumpProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seed, setSeed] = useState<StarSeed | null>(null)

  async function extract(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const ext = await window.api.brain.extract(text)
      setSeed(toSeed(ext, text))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (seed)
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <button
          type="button"
          onClick={() => setSeed(null)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" />
          Back to your notes
        </button>
        <div>
          <h1 className="text-2xl font-bold text-ink">Review the draft</h1>
          <p className="text-sm text-muted">
            Here&apos;s what I pulled out. Nothing is invented — edit anything, fill the gaps, then
            confirm.
          </p>
        </div>
        <StarForm
          seed={seed}
          skills={skills}
          tags={tags}
          onCancel={() => setSeed(null)}
          onSaved={(exp) => onSaved(exp.id)}
        />
      </div>
    )

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <button
        type="button"
        onClick={onExit}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Back to bank
      </button>
      <div>
        <h1 className="text-2xl font-bold text-ink">Brain dump</h1>
        <p className="text-sm text-muted">
          Ramble about something you did — messy is fine. I&apos;ll shape it into a STAR draft you
          can review and confirm.
        </p>
      </div>

      {error && <ErrorState description={error} />}

      <Textarea
        rows={10}
        value={text}
        placeholder="e.g. Last spring the checkout page kept crashing on mobile and support tickets were piling up. I dug into the logs, found a race in the payment retry, shipped a fix, and errors dropped to basically zero within a week…"
        onChange={(e) => setText(e.target.value)}
      />

      <div className="flex justify-end">
        <Button loading={busy} disabled={busy || !text.trim()} onClick={() => void extract()}>
          <Sparkles className="size-4" />
          Draft with AI
        </Button>
      </div>
    </div>
  )
}
