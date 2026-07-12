import { useEffect, useState } from 'react'
import { Clock, X } from 'lucide-react'
import type { Staleness } from '../../../preload/index.d'

export interface StalenessBannerProps {
  onNew: () => void
  reloadToken?: number
}

export function StalenessBanner({ onNew, reloadToken }: StalenessBannerProps): React.JSX.Element | null {
  const [s, setS] = useState<Staleness | null>(null)
  const [prefs, setPrefs] = useState<{ reminderIntervalDays: number } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let live = true
    void Promise.all([window.api.nudge.staleness(), window.api.prefs.get()]).then(([st, p]) => {
      if (!live) return
      setS(st)
      setPrefs({ reminderIntervalDays: p.reminderIntervalDays })
    })
    return () => {
      live = false
    }
  }, [reloadToken])

  if (dismissed || !s || !prefs) return null
  if (s.count === 0 || s.daysSinceLast == null) return null
  if (s.daysSinceLast < prefs.reminderIntervalDays) return null

  const weeks = Math.max(1, Math.round(s.daysSinceLast / 7))
  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-pop/30 bg-pop/10 px-4 py-3">
      <Clock aria-hidden className="size-4 shrink-0 text-pop" />
      <p className="flex-1 text-sm text-ink">
        It&apos;s been about {weeks} week{weeks === 1 ? '' : 's'} since your last story. Bank a fresh
        win while it&apos;s sharp.
      </p>
      <button
        onClick={onNew}
        className="rounded-pill bg-pop px-3 py-1 text-xs font-semibold text-on-pop hover:opacity-90"
      >
        Add a story
      </button>
      <button aria-label="Dismiss" onClick={() => setDismissed(true)} className="text-muted hover:text-ink">
        <X className="size-4" />
      </button>
    </div>
  )
}
