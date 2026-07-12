import { useEffect, useState } from 'react'
import { Share2 } from 'lucide-react'
import type { Neighbors } from '../lib/bank-types'

export interface ConnectedPanelProps {
  experienceId: string
  reloadKey?: number
  onOpen: (id: string) => void
}

export function ConnectedPanel({ experienceId, reloadKey, onOpen }: ConnectedPanelProps): React.JSX.Element | null {
  const [data, setData] = useState<Neighbors | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.graph.neighbors(experienceId).then((n) => {
      if (!cancelled) setData(n)
    })
    return () => {
      cancelled = true
    }
  }, [experienceId, reloadKey])

  if (!data || (data.entities.length === 0 && data.connections.length === 0)) return null

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted">
        <Share2 className="size-4" />
        Connected to
      </h2>

      {data.entities.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {data.entities.map((e) => (
            <span
              key={e.id}
              className="rounded-pill bg-raised px-2.5 py-0.5 text-xs font-medium text-ink"
              title={e.kind}
            >
              {e.name}
            </span>
          ))}
        </div>
      )}

      {data.connections.length > 0 && (
        <ul className="space-y-2">
          {data.connections.map((c) => (
            <li key={c.experience.id}>
              <button
                type="button"
                onClick={() => onOpen(c.experience.id)}
                className="w-full rounded-lg border border-line bg-raised p-3 text-left hover:border-fg-brand"
              >
                <div className="text-sm font-semibold text-ink">{c.experience.title}</div>
                <div className="mt-0.5 text-xs text-faint">
                  {[...c.viaEntities, ...c.viaSkills].slice(0, 6).join(' · ')}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
