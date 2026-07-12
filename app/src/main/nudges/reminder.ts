import { Notification } from 'electron'
import { getPrefs, setPrefs, staleness, type Prefs, type Staleness } from '../settings/prefs'

const DAY_MS = 86_400_000
const CHECK_INTERVAL_MS = 60 * 60 * 1000

export function shouldRemind(prefs: Prefs, s: Staleness, nowMs: number): boolean {
  if (!prefs.reminderEnabled) return false
  if (s.count === 0) return false
  if (s.daysSinceLast == null) return false
  if (s.daysSinceLast < prefs.reminderIntervalDays) return false
  if (prefs.reminderSnoozedAt) {
    const snoozedMs = Date.parse(prefs.reminderSnoozedAt)
    if (Number.isFinite(snoozedMs) && nowMs - snoozedMs < prefs.reminderIntervalDays * DAY_MS) {
      return false
    }
  }
  return true
}

function fire(s: Staleness, onActivate?: () => void): void {
  if (!Notification.isSupported()) return
  const weeks = Math.max(1, Math.round((s.daysSinceLast ?? 0) / 7))
  const n = new Notification({
    title: 'Time to bank a win',
    body: `Your last story was logged about ${weeks} week${weeks === 1 ? '' : 's'} ago. Add a fresh one while it's still sharp.`
  })
  n.on('click', () => onActivate?.())
  n.show()
  setPrefs({ reminderSnoozedAt: new Date().toISOString() })
}

let timer: ReturnType<typeof setInterval> | null = null

export function startReminderScheduler(onActivate?: () => void): void {
  stopReminderScheduler()
  const tick = (): void => {
    const s = staleness()
    if (shouldRemind(getPrefs(), s, Date.now())) fire(s, onActivate)
  }
  timer = setInterval(tick, CHECK_INTERVAL_MS)
  setTimeout(tick, 10_000)
}

export function stopReminderScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
