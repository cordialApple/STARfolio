import { Plus, X } from 'lucide-react'
import { Input, Button, IconButton } from '../components'
import type { MetricInput } from '../lib/bank-types'

export interface MetricsFieldProps {
  value: MetricInput[]
  onChange: (next: MetricInput[]) => void
}

export function MetricsField({ value, onChange }: MetricsFieldProps): React.JSX.Element {
  function update(i: number, patch: Partial<MetricInput>): void {
    onChange(value.map((m, idx) => (idx === i ? { ...m, ...patch } : m)))
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-ink">Metrics</label>
      {value.length > 0 && (
        <ul className="mb-2 space-y-2">
          {value.map((m, i) => (
            <li key={i} className="flex gap-2">
              <Input
                value={m.label}
                placeholder="What you moved (e.g. deploy time)"
                onChange={(e) => update(i, { label: e.target.value })}
                className="flex-[2]"
                aria-label="Metric label"
              />
              <Input
                value={m.value == null ? '' : String(m.value)}
                inputMode="decimal"
                placeholder="Value"
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  const num = Number(raw)
                  update(i, { value: raw === '' || Number.isNaN(num) ? null : num })
                }}
                className="flex-1"
                aria-label="Metric value"
              />
              <Input
                value={m.unit ?? ''}
                placeholder="Unit"
                onChange={(e) => update(i, { unit: e.target.value || null })}
                className="w-24"
                aria-label="Metric unit"
              />
              <IconButton
                label="Remove metric"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              >
                <X className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onChange([...value, { label: '', value: null, unit: null }])}
      >
        <Plus className="size-4" />
        Add metric
      </Button>
    </div>
  )
}
