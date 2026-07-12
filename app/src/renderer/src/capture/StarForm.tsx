import { useMemo, useState } from 'react'
import { Check, FileText, HelpCircle } from 'lucide-react'
import {
  Badge,
  Button,
  Input,
  Textarea,
  Select,
  StarRail,
  useToast,
  STAR_LABELS,
  type BadgeTone,
  type StarBeat
} from '../components'
import type {
  Confidence,
  Experience,
  ExperienceContext,
  ExperienceInput,
  GapField,
  MetricInput,
  Skill,
  SkillInput,
  SourceInput,
  Tag
} from '../lib/bank-types'
import { BEAT_ACCENT, CONTEXTS, CONTEXT_LABELS } from '../lib/format'
import { ChipField } from './ChipField'
import { SkillField } from './SkillField'
import { MetricsField } from './MetricsField'
import { cn } from '../lib/cn'

type BeatKey = 'situation' | 'task' | 'action' | 'result_text'

const BEATS: { key: BeatKey; beat: StarBeat; hint: string }[] = [
  { key: 'situation', beat: 's', hint: 'Set the scene — where, when, and what was at stake.' },
  { key: 'task', beat: 't', hint: 'Your specific responsibility or the goal you owned.' },
  { key: 'action', beat: 'a', hint: 'What you actually did — the steps you drove.' },
  { key: 'result_text', beat: 'r', hint: 'The outcome, ideally something you can measure.' }
]

const CONFIDENCE_TONE: Record<Confidence, BadgeTone> = {
  high: 'success',
  medium: 'neutral',
  low: 'warning'
}
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'from your notes',
  medium: 'inferred',
  low: 'guessed'
}

export interface Gap {
  field: GapField
  question: string
}
interface DraftState {
  gaps?: Gap[]
  confidence?: Partial<Record<BeatKey, Confidence>>
}

export interface StarSeed {
  values: Partial<FormState>
  source?: SourceInput
  sourceId?: string
  gaps?: Gap[]
  confidence?: Partial<Record<BeatKey, Confidence>>
}

interface FormState {
  title: string
  situation: string
  task: string
  action: string
  result_text: string
  context: ExperienceContext
  happened_start: string
  happened_end: string
  skills: SkillInput[]
  tags: string[]
  metrics: MetricInput[]
}

const EMPTY: FormState = {
  title: '',
  situation: '',
  task: '',
  action: '',
  result_text: '',
  context: 'work',
  happened_start: '',
  happened_end: '',
  skills: [],
  tags: [],
  metrics: []
}

function toState(initial?: Experience, seed?: StarSeed): FormState {
  if (initial)
    return {
      title: initial.title,
      situation: initial.situation,
      task: initial.task,
      action: initial.action,
      result_text: initial.result_text,
      context: initial.context,
      happened_start: initial.happened_start?.slice(0, 7) ?? '',
      happened_end: initial.happened_end?.slice(0, 7) ?? '',
      skills: initial.skills.map((s) => ({ name: s.name, kind: s.kind })),
      tags: initial.tags.map((t) => t.name),
      metrics: initial.metrics.map((m) => ({ label: m.label, value: m.value, unit: m.unit }))
    }
  return { ...EMPTY, ...seed?.values }
}

function parseDraftState(json: string | null | undefined): DraftState {
  if (!json) return {}
  try {
    return JSON.parse(json) as DraftState
  } catch {
    return {}
  }
}

const monthToDate = (v: string): string | null => (v ? `${v}-01` : null)

export interface StarFormProps {
  initial?: Experience
  seed?: StarSeed
  skills: Skill[]
  tags: Tag[]
  onSaved: (exp: Experience) => void
  onCancel: () => void
}

export function StarForm({
  initial,
  seed,
  skills,
  tags,
  onSaved,
  onCancel
}: StarFormProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(() => toState(initial, seed))
  const [saving, setSaving] = useState<false | 'draft' | 'confirmed'>(false)
  const [showErrors, setShowErrors] = useState(false)
  const toast = useToast()

  const draftState = useMemo(
    () => (seed ? { gaps: seed.gaps, confidence: seed.confidence } : parseDraftState(initial?.draft_state_json)),
    [seed, initial]
  )
  const gaps = draftState.gaps ?? []
  const confidence = draftState.confidence ?? {}

  const set = <K extends keyof FormState>(key: K, val: FormState[K]): void =>
    setForm((f) => ({ ...f, [key]: val }))

  const filled = useMemo<StarBeat[]>(() => {
    const b: StarBeat[] = []
    if (form.situation.trim()) b.push('s')
    if (form.task.trim()) b.push('t')
    if (form.action.trim()) b.push('a')
    if (form.result_text.trim()) b.push('r')
    return b
  }, [form.situation, form.task, form.action, form.result_text])

  const titleMissing = !form.title.trim()
  const beatsMissing = filled.length < 4
  const dateInverted =
    !!form.happened_start && !!form.happened_end && form.happened_end < form.happened_start

  function build(status: 'draft' | 'confirmed'): ExperienceInput {
    const input: ExperienceInput = {
      title: form.title.trim(),
      situation: form.situation,
      task: form.task,
      action: form.action,
      result_text: form.result_text,
      context: form.context,
      happened_start: monthToDate(form.happened_start),
      happened_end: monthToDate(form.happened_end),
      status,
      skills: form.skills,
      tags: form.tags,
      metrics: form.metrics.filter((m) => m.label.trim()),
      // A confirmed record is complete, so its draft-conversation state is cleared.
      draft_state_json: status === 'draft' && gaps.length > 0 ? JSON.stringify(draftState) : null
    }
    if (!initial && seed?.sourceId) input.source_id = seed.sourceId
    else if (!initial && seed?.source) input.source = seed.source
    return input
  }

  async function save(status: 'draft' | 'confirmed'): Promise<void> {
    setShowErrors(true)
    if (titleMissing || dateInverted || (status === 'confirmed' && beatsMissing)) {
      toast('Fill the highlighted fields before saving.', 'danger')
      return
    }
    setSaving(status)
    try {
      const input = build(status)
      const saved = initial
        ? await window.api.bank.update(initial.id, input)
        : await window.api.bank.create(input)
      toast(
        status === 'confirmed' ? 'Experience confirmed.' : 'Draft saved.',
        status === 'confirmed' ? 'success' : 'neutral'
      )
      onSaved(saved)
    } catch (err) {
      toast(`Could not save: ${(err as Error).message}`, 'danger')
      setSaving(false)
    }
  }

  return (
    <form
      className="mx-auto w-full max-w-2xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        void save('confirmed')
      }}
    >
      <div className="flex items-center gap-3">
        <StarRail filled={filled} className="w-24" label={`${filled.length} of 4 STAR beats`} />
        <span className="text-xs font-semibold text-muted">{filled.length}/4 beats</span>
      </div>

      {gaps.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg-warning">
            <HelpCircle className="size-4" />
            A few things to fill in
          </p>
          <ul className="space-y-1 text-sm text-ink">
            {gaps.map((g, i) => (
              <li key={i}>{g.question}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label htmlFor="exp-title" className="mb-1.5 block text-sm font-semibold text-ink">
          Title
        </label>
        <Input
          id="exp-title"
          value={form.title}
          invalid={showErrors && titleMissing}
          placeholder="Name this accomplishment in a few words"
          onChange={(e) => set('title', e.target.value)}
        />
        {showErrors && titleMissing && (
          <p className="mt-1 text-xs text-fg-danger">Give it a title so you can find it later.</p>
        )}
      </div>

      <div className="space-y-4">
        {BEATS.map(({ key, beat, hint }) => {
          const conf = confidence[key]
          return (
            <div key={key} className={cn('border-l-2 pl-3', BEAT_ACCENT[beat])}>
              <label
                htmlFor={`exp-${key}`}
                className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-semibold text-ink"
              >
                <span className="flex items-center gap-2">
                  {STAR_LABELS[beat]}
                  {conf && <Badge tone={CONFIDENCE_TONE[conf]}>{CONFIDENCE_LABEL[conf]}</Badge>}
                </span>
                <span className="text-xs font-normal text-faint">{hint}</span>
              </label>
              <Textarea
                id={`exp-${key}`}
                rows={key === 'action' ? 4 : 3}
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
              />
            </div>
          )
        })}
        {showErrors && beatsMissing && (
          <p className="text-xs text-fg-warning">
            All four beats make the strongest story. You can still save it as a draft.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="exp-context" className="mb-1.5 block text-sm font-semibold text-ink">
            Context
          </label>
          <Select
            id="exp-context"
            value={form.context}
            onChange={(e) => set('context', e.target.value as ExperienceContext)}
          >
            {CONTEXTS.map((c) => (
              <option key={c} value={c}>
                {CONTEXT_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="exp-start" className="mb-1.5 block text-sm font-semibold text-ink">
            Started
          </label>
          <Input
            id="exp-start"
            type="month"
            value={form.happened_start}
            onChange={(e) => set('happened_start', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="exp-end" className="mb-1.5 block text-sm font-semibold text-ink">
            Ended
          </label>
          <Input
            id="exp-end"
            type="month"
            value={form.happened_end}
            invalid={showErrors && dateInverted}
            onChange={(e) => set('happened_end', e.target.value)}
          />
        </div>
      </div>
      {showErrors && dateInverted && (
        <p className="-mt-2 text-xs text-fg-danger">End month is before the start month.</p>
      )}

      <SkillField value={form.skills} onChange={(v) => set('skills', v)} suggestions={skills} />
      <ChipField
        label="Tags"
        value={form.tags}
        onChange={(v) => set('tags', v)}
        suggestions={tags.map((t) => t.name)}
        placeholder="Add a tag and press Enter"
      />
      <MetricsField value={form.metrics} onChange={(v) => set('metrics', v)} />

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-5">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={!!saving}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={saving === 'draft'}
          disabled={!!saving}
          onClick={() => void save('draft')}
        >
          <FileText className="size-4" />
          Save draft
        </Button>
        <Button type="submit" loading={saving === 'confirmed'} disabled={!!saving}>
          <Check className="size-4" />
          {initial?.status === 'confirmed' ? 'Save' : 'Confirm'}
        </Button>
      </div>
    </form>
  )
}
