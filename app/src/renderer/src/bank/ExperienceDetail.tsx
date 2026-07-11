import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Check, Pencil, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  Skeleton,
  ErrorState,
  StarRail,
  useToast,
  STAR_LABELS,
  STAR_BEATS,
  type StarBeat
} from '../components'
import type { Experience } from '../lib/bank-types'
import {
  BEAT_ACCENT,
  CONTEXT_LABELS,
  CONTEXT_TONE,
  SKILL_KIND_DOT,
  formatDateRange,
  filledBeats
} from '../lib/format'
import { cn } from '../lib/cn'

const BEAT_FIELD: Record<StarBeat, keyof Pick<Experience, 'situation' | 'task' | 'action' | 'result_text'>> =
  {
    s: 'situation',
    t: 'task',
    a: 'action',
    r: 'result_text'
  }

export interface ExperienceDetailProps {
  id: string
  onBack: () => void
  onEdit: (exp: Experience) => void
  onDeleted: () => void
  onChanged: (exp: Experience) => void
}

export function ExperienceDetail({
  id,
  onBack,
  onEdit,
  onDeleted,
  onChanged
}: ExperienceDetailProps): React.JSX.Element {
  const [exp, setExp] = useState<Experience | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setExp(await window.api.bank.get(id))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function confirmDraft(): Promise<void> {
    if (!exp) return
    setBusy(true)
    try {
      const saved = await window.api.bank.update(exp.id, {
        title: exp.title,
        situation: exp.situation,
        task: exp.task,
        action: exp.action,
        result_text: exp.result_text,
        context: exp.context,
        happened_start: exp.happened_start,
        happened_end: exp.happened_end,
        status: 'confirmed',
        skills: exp.skills.map((s) => ({ name: s.name, kind: s.kind })),
        tags: exp.tags.map((t) => t.name),
        metrics: exp.metrics.map((m) => ({ label: m.label, value: m.value, unit: m.unit }))
      })
      setExp(saved)
      onChanged(saved)
      toast('Experience confirmed.', 'success')
    } catch (err) {
      toast(`Could not confirm: ${(err as Error).message}`, 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    setBusy(true)
    try {
      await window.api.bank.remove(id)
      toast('Experience deleted.', 'neutral')
      onDeleted()
    } catch (err) {
      toast(`Could not delete: ${(err as Error).message}`, 'danger')
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  if (error)
    return (
      <div className="mx-auto max-w-2xl">
        <BackLink onBack={onBack} />
        <ErrorState description={error} action={<Button onClick={() => void load()}>Retry</Button>} />
      </div>
    )

  if (exp === undefined)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink onBack={onBack} />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )

  if (exp === null)
    return (
      <div className="mx-auto max-w-2xl">
        <BackLink onBack={onBack} />
        <ErrorState title="Not found" description="This experience no longer exists." />
      </div>
    )

  const dates = formatDateRange(exp.happened_start, exp.happened_end)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink onBack={onBack} />

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-ink">{exp.title || 'Untitled experience'}</h1>
          <StarRail
            filled={filledBeats({
              situation: !!exp.situation,
              task: !!exp.task,
              action: !!exp.action,
              result: !!exp.result_text
            })}
            className="mt-2 w-24 shrink-0"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={CONTEXT_TONE[exp.context]}>{CONTEXT_LABELS[exp.context]}</Badge>
          {exp.status === 'draft' ? (
            <Badge tone="warning">Draft</Badge>
          ) : (
            <Badge tone="success">Confirmed</Badge>
          )}
          {dates && <span className="text-sm text-muted">{dates}</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {exp.status === 'draft' && (
          <Button size="sm" loading={busy} onClick={() => void confirmDraft()}>
            <Check className="size-4" />
            Confirm
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => onEdit(exp)}>
          <Pencil className="size-4" />
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="size-4" />
          Delete
        </Button>
      </div>

      <div className="space-y-4">
        {STAR_BEATS.map((beat) => {
          const text = exp[BEAT_FIELD[beat]]
          return (
            <section key={beat} className={cn('border-l-2 pl-3', BEAT_ACCENT[beat])}>
              <h2 className="mb-1 text-sm font-semibold text-muted">{STAR_LABELS[beat]}</h2>
              {text ? (
                <p className="whitespace-pre-wrap text-ink">{text}</p>
              ) : (
                <p className="text-sm italic text-faint">Not filled in yet.</p>
              )}
            </section>
          )
        })}
      </div>

      {exp.metrics.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted">Metrics</h2>
          <ul className="flex flex-wrap gap-2">
            {exp.metrics.map((m) => (
              <li
                key={m.id}
                className="rounded-lg border border-line bg-raised px-3 py-1.5 text-sm text-ink"
              >
                <span className="text-muted">{m.label}:</span>{' '}
                <span className="font-semibold">
                  {m.value ?? ''}
                  {m.unit ? ` ${m.unit}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(exp.skills.length > 0 || exp.tags.length > 0) && (
        <section className="flex flex-wrap gap-1.5">
          {exp.skills.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1.5 rounded-pill bg-raised px-2.5 py-0.5 text-xs font-semibold text-ink"
            >
              <span className={cn('size-2 rounded-pill', SKILL_KIND_DOT[s.kind])} aria-hidden />
              {s.name}
            </span>
          ))}
          {exp.tags.map((t) => (
            <span
              key={t.id}
              className="rounded-pill bg-raised px-2.5 py-0.5 text-xs font-medium text-muted"
            >
              #{t.name}
            </span>
          ))}
        </section>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete this experience?"
        description="This removes it from your bank for good. This can't be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  )
}

function BackLink({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
    >
      <ArrowLeft className="size-4" />
      Back to bank
    </button>
  )
}
