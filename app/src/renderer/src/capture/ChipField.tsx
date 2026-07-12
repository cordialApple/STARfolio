import { useId, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { Input } from '../components'

export interface ChipFieldProps {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  placeholder?: string
}

export function ChipField({
  label,
  value,
  onChange,
  suggestions = [],
  placeholder
}: ChipFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const listId = useId()

  function add(raw: string): void {
    const name = raw.trim()
    if (!name) return
    if (!value.some((v) => v.toLowerCase() === name.toLowerCase())) onChange([...value, name])
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

  const open = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-ink">{label}</label>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((name) => (
            <li
              key={name}
              className="inline-flex items-center gap-1 rounded-pill bg-raised py-0.5 pl-2.5 pr-1 text-xs font-semibold text-ink"
            >
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(value.filter((v) => v !== name))}
                className="grid size-4 place-items-center rounded-pill text-muted hover:bg-line hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        value={draft}
        list={listId}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
      />
      <datalist id={listId}>
        {open.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}
