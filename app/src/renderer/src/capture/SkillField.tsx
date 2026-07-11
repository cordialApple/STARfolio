import { useId, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { Input, Select } from '../components'
import type { Skill, SkillInput, SkillKind } from '../lib/bank-types'
import { SKILL_KIND_LABELS, SKILL_KIND_DOT } from '../lib/format'
import { cn } from '../lib/cn'

const KINDS: SkillKind[] = ['technical', 'soft', 'domain']

export interface SkillFieldProps {
  value: SkillInput[]
  onChange: (next: SkillInput[]) => void
  suggestions?: Skill[]
}

export function SkillField({
  value,
  onChange,
  suggestions = []
}: SkillFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<SkillKind>('technical')
  const listId = useId()

  function add(raw: string): void {
    const name = raw.trim()
    if (!name) return
    if (value.some((v) => v.name.toLowerCase() === name.toLowerCase())) {
      setDraft('')
      return
    }
    const known = suggestions.find((s) => s.name.toLowerCase() === name.toLowerCase())
    onChange([...value, { name: known?.name ?? name, kind: known?.kind ?? kind }])
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  const open = suggestions.filter(
    (s) => !value.some((v) => v.name.toLowerCase() === s.name.toLowerCase())
  )

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-ink">Skills</label>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((s) => (
            <li
              key={s.name}
              className="inline-flex items-center gap-1.5 rounded-pill bg-raised py-0.5 pl-2 pr-1 text-xs font-semibold text-ink"
            >
              <span className={cn('size-2 rounded-pill', SKILL_KIND_DOT[s.kind])} aria-hidden />
              {s.name}
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                onClick={() => onChange(value.filter((v) => v.name !== s.name))}
                className="grid size-4 place-items-center rounded-pill text-muted hover:bg-line hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          list={listId}
          placeholder="Add a skill and press Enter"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          className="flex-1"
        />
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value as SkillKind)}
          className="w-32"
          aria-label="Skill kind for new skills"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {SKILL_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </div>
      <datalist id={listId}>
        {open.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
    </div>
  )
}
