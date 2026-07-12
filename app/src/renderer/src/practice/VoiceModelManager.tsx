import { useEffect, useState } from 'react'
import { Download, Trash2, Check, Loader2 } from 'lucide-react'
import { Badge, Button } from '../components'
import { cn } from '../lib/cn'
import type { WhisperModelInfo, WhisperModelName } from '../lib/bank-types'

const HINTS: Record<WhisperModelName, string> = {
  'tiny.en': 'Fastest, least accurate',
  'base.en': 'Recommended — good balance',
  'small.en': 'Most accurate, slowest'
}

export interface VoiceModelManagerProps {
  selected: WhisperModelName
  onSelect: (model: WhisperModelName) => void
}

export function VoiceModelManager({ selected, onSelect }: VoiceModelManagerProps): React.JSX.Element {
  const [models, setModels] = useState<WhisperModelInfo[] | null>(null)
  const [busy, setBusy] = useState<WhisperModelName | null>(null)

  useEffect(() => {
    void window.api.voice.models().then(setModels)
    return window.api.voice.onModelStatus(setModels)
  }, [])

  async function download(name: WhisperModelName): Promise<void> {
    setBusy(name)
    try {
      setModels(await window.api.voice.downloadModel(name))
    } finally {
      setBusy(null)
    }
  }
  async function remove(name: WhisperModelName): Promise<void> {
    setModels(await window.api.voice.deleteModel(name))
  }

  if (models === null) return <p className="text-xs text-muted">Loading voice models…</p>

  return (
    <ul className="space-y-2">
      {models.map((m) => {
        const downloading = m.status.phase === 'downloading'
        return (
          <li
            key={m.name}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3',
              selected === m.name ? 'border-brand bg-brand-soft/40' : 'border-line'
            )}
          >
            <button
              type="button"
              onClick={() => m.downloaded && onSelect(m.name)}
              disabled={!m.downloaded}
              aria-pressed={selected === m.name}
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border',
                selected === m.name ? 'border-brand bg-brand text-on-brand' : 'border-line',
                !m.downloaded && 'opacity-40'
              )}
            >
              {selected === m.name && <Check className="size-3.5" />}
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ink">{m.name}</span>
                <span className="text-xs text-faint">{m.sizeMB} MB</span>
                {m.downloaded ? (
                  <Badge tone="success">Installed</Badge>
                ) : downloading ? (
                  <Badge tone="info">{m.status.progress}%</Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted">{HINTS[m.name]}</p>
            </div>

            {downloading ? (
              <Loader2 className="size-4 animate-spin text-muted" />
            ) : m.downloaded ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void remove(m.name)}
                aria-label={`Delete ${m.name}`}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === m.name}
                disabled={busy !== null}
                onClick={() => void download(m.name)}
              >
                <Download className="size-4" />
                Download
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
