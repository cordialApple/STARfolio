import { useEffect, useState } from 'react'
import { KeyRound, Check, Trash2, ExternalLink, GitBranch, Share2, Download, Upload, HardDriveDownload, Bell, RefreshCw, Coins, Volume2, Search, Palette, Monitor, Sun, Moon, Database, FolderOpen } from 'lucide-react'
import type { Prefs, UpdateStatus, UsageSummary, VaultStatus } from '../../../preload/index.d'
import { Badge, Button, Card, Input, Skeleton, StoragePill, Toggle, useToast } from '../components'
import { cn } from '../lib/cn'
import { useTheme } from '../theme/ThemeProvider'
import type { ThemeMode } from '../theme/ThemeProvider'
import { VoiceModelManager } from './VoiceModelManager'

const FEATURE_LABELS: Record<string, string> = {
  chat: 'Brain dump',
  extract: 'Story extraction',
  story: 'Story generation',
  bullets: 'Resume bullets',
  practice: 'Behavioral practice',
  technical: 'Technical practice',
  other: 'Other'
}

function formatCost(value: number): string {
  if (value <= 0) return '$0.00'
  if (value < 0.01) return '<$0.01'
  return `$${value.toFixed(2)}`
}

type SectionId = 'reminders' | 'appearance' | 'apikey' | 'github' | 'voice' | 'connections' | 'storage' | 'data' | 'spend' | 'updates'

const SECTIONS: { group: string; items: { id: SectionId; label: string; icon: typeof Bell }[] }[] = [
  {
    group: 'General',
    items: [
      { id: 'reminders', label: 'Reminders & startup', icon: Bell },
      { id: 'appearance', label: 'Appearance', icon: Palette }
    ]
  },
  {
    group: 'AI',
    items: [
      { id: 'apikey', label: 'Anthropic API key', icon: KeyRound },
      { id: 'github', label: 'GitHub token', icon: GitBranch },
      { id: 'voice', label: 'Voice', icon: Volume2 }
    ]
  },
  {
    group: 'Data',
    items: [
      { id: 'connections', label: 'Connections', icon: Share2 },
      { id: 'storage', label: 'Storage', icon: Database },
      { id: 'data', label: 'Data & backups', icon: HardDriveDownload }
    ]
  },
  { group: 'Usage', items: [{ id: 'spend', label: 'Spend', icon: Coins }] },
  { group: 'About', items: [{ id: 'updates', label: 'Updates', icon: RefreshCw }] }
]

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: typeof Bell }[] = [
  { mode: 'system', label: 'System', icon: Monitor },
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon }
]

export function SettingsView(): React.JSX.Element {
  const toast = useToast()
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasPat, setHasPat] = useState<boolean | null>(null)
  const [pat, setPat] = useState('')
  const [patBusy, setPatBusy] = useState(false)
  const [graphBusy, setGraphBusy] = useState(false)
  const [dataBusy, setDataBusy] = useState(false)
  const [prefs, setPrefsState] = useState<Prefs | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [active, setActive] = useState<SectionId>('reminders')
  const [q, setQ] = useState('')
  const [vault, setVault] = useState<VaultStatus | null>(null)
  const [vaultBusy, setVaultBusy] = useState(false)

  async function savePrefs(patch: Partial<Prefs>): Promise<void> {
    setPrefsState((prev) => (prev ? { ...prev, ...patch } : prev))
    try {
      const next = await window.api.prefs.set(patch)
      setPrefsState(next)
    } catch (err) {
      toast(`Could not save setting: ${(err as Error).message}`, 'danger')
      setPrefsState(await window.api.prefs.get())
    }
  }

  async function runData(errPrefix: string, fn: () => Promise<void>): Promise<void> {
    setDataBusy(true)
    try {
      await fn()
    } catch (err) {
      toast(`${errPrefix}: ${(err as Error).message}`, 'danger')
    } finally {
      setDataBusy(false)
    }
  }

  function exportBank(): Promise<void> {
    return runData('Could not export bank', async () => {
      const res = await window.api.backup.exportJson()
      if (res.saved) toast(`Bank exported to ${res.path}`, 'success')
    })
  }

  function importBank(): Promise<void> {
    return runData('Could not import bank', async () => {
      const res = await window.api.backup.importJson()
      if (!res.canceled)
        toast(
          res.imported > 0 ? `Imported ${res.imported} experiences.` : 'Nothing to import.',
          'success'
        )
    })
  }

  function backupDb(): Promise<void> {
    return runData('Could not back up', async () => {
      const res = await window.api.backup.create()
      if (res.saved) toast(`Backed up to ${res.path}`, 'success')
    })
  }

  async function buildConnections(): Promise<void> {
    setGraphBusy(true)
    try {
      const { processed } = await window.api.graph.backfill()
      toast(
        processed > 0 ? `Linked entities across ${processed} experiences.` : 'Everything is already connected.',
        'success'
      )
    } catch (err) {
      toast(`Could not build connections: ${(err as Error).message}`, 'danger')
    } finally {
      setGraphBusy(false)
    }
  }

  async function refresh(): Promise<void> {
    setHasKey(await window.api.ai.hasKey())
    setHasPat(await window.api.github.hasPat())
    setPrefsState(await window.api.prefs.get())
    setUsage(await window.api.usage.summary())
    setVault(await window.api.vault.status())
  }

  async function setStorageMode(mode: Prefs['storageMode']): Promise<void> {
    if (mode === 'obsidian' && !vault?.vaultPath) {
      const res = await window.api.vault.choose()
      if (res.canceled) return
    }
    setVaultBusy(true)
    try {
      await savePrefs({ storageMode: mode })
      setVault(await window.api.vault.status())
      toast(mode === 'obsidian' ? 'Switched to Obsidian vault.' : 'Switched to SQLite.', 'success')
    } finally {
      setVaultBusy(false)
    }
  }

  async function chooseVault(): Promise<void> {
    const res = await window.api.vault.choose()
    if (res.canceled) return
    setVault(await window.api.vault.status())
    if (prefs?.storageMode === 'obsidian') await syncVault()
  }

  async function syncVault(): Promise<void> {
    setVaultBusy(true)
    try {
      const res = await window.api.vault.sync()
      if (res.error === 'no-vault') {
        toast('Pick a vault folder first.', 'info')
        return
      }
      toast(`Synced — ${res.imported} in, ${res.exported} out.`, 'success')
      setVault(await window.api.vault.status())
    } catch (err) {
      toast(`Could not sync vault: ${(err as Error).message}`, 'danger')
    } finally {
      setVaultBusy(false)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    void window.api.update.version().then(setAppVersion)
    void window.api.update.status().then(setUpdate)
    return window.api.update.onStatus(setUpdate)
  }, [])

  function checkUpdate(): void {
    void window.api.update.check()
  }
  function downloadUpdate(): void {
    void window.api.update.download()
  }
  function installUpdate(): void {
    void window.api.update.install()
  }

  async function savePat(): Promise<void> {
    const value = pat.trim()
    if (!value) return
    setPatBusy(true)
    try {
      await window.api.github.setPat(value)
      setPat('')
      await refresh()
      toast('GitHub token saved.', 'success')
    } catch (err) {
      toast(`Could not save token: ${(err as Error).message}`, 'danger')
    } finally {
      setPatBusy(false)
    }
  }

  async function removePat(): Promise<void> {
    setPatBusy(true)
    try {
      await window.api.github.deletePat()
      await refresh()
      toast('GitHub token removed.', 'neutral')
    } catch (err) {
      toast(`Could not remove token: ${(err as Error).message}`, 'danger')
    } finally {
      setPatBusy(false)
    }
  }

  async function save(): Promise<void> {
    const value = key.trim()
    if (!value) return
    setBusy(true)
    try {
      await window.api.ai.setKey(value)
      setKey('')
      await refresh()
      toast('API key saved.', 'success')
    } catch (err) {
      toast(`Could not save key: ${(err as Error).message}`, 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    setBusy(true)
    try {
      await window.api.ai.deleteKey()
      await refresh()
      toast('API key removed.', 'neutral')
    } catch (err) {
      toast(`Could not remove key: ${(err as Error).message}`, 'danger')
    } finally {
      setBusy(false)
    }
  }

  const ql = q.trim().toLowerCase()
  const groups = SECTIONS.map((g) => ({
    ...g,
    items: g.items.filter((it) => !ql || it.label.toLowerCase().includes(ql))
  })).filter((g) => g.items.length > 0)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Settings</h1>
        <p className="text-sm text-muted">Your key and data stay on this machine.</p>
      </div>

      <div className="flex gap-6">
        <aside className="w-56 shrink-0 space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              className="pl-9"
              placeholder="Search settings"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <nav className="space-y-4">
            {groups.map((g) => (
              <div key={g.group} className="space-y-1">
                <p className="px-3 text-xs font-semibold uppercase tracking-wide text-faint">
                  {g.group}
                </p>
                {g.items.map((it) => {
                  const Icon = it.icon
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setActive(it.id)}
                      aria-current={active === it.id ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm',
                        active === it.id
                          ? 'bg-raised font-semibold text-ink'
                          : 'text-muted hover:bg-raised/50 hover:text-ink'
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {it.label}
                    </button>
                  )
                })}
              </div>
            ))}
            {groups.length === 0 && (
              <p className="px-3 text-sm text-faint">No settings match “{q}”.</p>
            )}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
      {active === 'apikey' && (
      <Card
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Anthropic API key
          </span>
        }
        action={
          hasKey === null ? null : hasKey ? (
            <Badge tone="success">
              <Check className="size-3" />
              Saved
            </Badge>
          ) : (
            <Badge tone="warning">Not set</Badge>
          )
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Brain dump, story generation, and live practice call the Anthropic API. Your key is
            stored encrypted by the OS (never in plain text) and never leaves your machine except in
            calls to Anthropic.
          </p>

          {hasKey === null ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <>
              <label className="space-y-1">
                <span className="text-sm font-semibold text-muted">
                  {hasKey ? 'Replace key' : 'Paste your key'}
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  placeholder="sk-ant-…"
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void save()
                  }}
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button loading={busy} disabled={busy || !key.trim()} onClick={() => void save()}>
                  Save key
                </Button>
                {hasKey && (
                  <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                )}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-fg-brand hover:underline"
                >
                  Get a key
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </>
          )}
        </div>
      </Card>
      )}

      {active === 'github' && (
      <Card
        title={
          <span className="flex items-center gap-2">
            <GitBranch className="size-4" />
            GitHub token (optional)
          </span>
        }
        action={
          hasPat === null ? null : hasPat ? (
            <Badge tone="success">
              <Check className="size-3" />
              Saved
            </Badge>
          ) : (
            <Badge tone="neutral">Not set</Badge>
          )
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Only needed to import <span className="font-semibold">private</span> repositories, or to
            raise the GitHub rate limit. Stored encrypted by the OS, same as your API key. A
            fine-grained token with read-only contents access is enough.
          </p>

          {hasPat === null ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <>
              <label className="space-y-1">
                <span className="text-sm font-semibold text-muted">
                  {hasPat ? 'Replace token' : 'Paste your token'}
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={pat}
                  placeholder="github_pat_…"
                  onChange={(e) => setPat(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void savePat()
                  }}
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button loading={patBusy} disabled={patBusy || !pat.trim()} onClick={() => void savePat()}>
                  Save token
                </Button>
                {hasPat && (
                  <Button variant="ghost" disabled={patBusy} onClick={() => void removePat()}>
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                )}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-fg-brand hover:underline"
                >
                  Get a token
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </>
          )}
        </div>
      </Card>
      )}

      {active === 'voice' && (
      <Card
        title={
          <span className="flex items-center gap-2">
            <Volume2 className="size-4" />
            Voice
          </span>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Download a whisper model to speak your answers in behavioral and technical practice.
            Models run fully on-device — nothing is uploaded. The selected model is used for
            push-to-talk.
          </p>
          <VoiceModelManager
            selected={prefs?.voiceModel ?? 'base.en'}
            onSelect={(m) => void savePrefs({ voiceModel: m })}
          />
        </div>
      </Card>
      )}

      {active === 'connections' && (
      <Card
        title={
          <span className="flex items-center gap-2">
            <Share2 className="size-4" />
            Connections
          </span>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Scan your existing experiences for the people, projects, and tools they mention, so the
            bank can show what&apos;s connected. Imported evidence links automatically — this catches
            up everything else.
          </p>
          <Button variant="secondary" loading={graphBusy} disabled={graphBusy} onClick={() => void buildConnections()}>
            <Share2 className="size-4" />
            Build connections
          </Button>
        </div>
      </Card>
      )}

      {active === 'storage' && (
      <Card
        title={
          <span className="flex items-center gap-2">
            <Database className="size-4" />
            Storage
          </span>
        }
        action={
          <StoragePill
            value={prefs?.storageMode ?? 'sqlite'}
            onChange={(m) => void setStorageMode(m)}
            disabled={vaultBusy || prefs === null}
          />
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            SQLite keeps everything in one on-device database. Obsidian mirrors each experience to a
            plain-markdown vault folder you can open in Obsidian, edit by hand, and sync yourself.
            Switching either way merges by experience id — newer edits win, nothing is deleted.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={vaultBusy} onClick={() => void chooseVault()}>
              <FolderOpen className="size-4" />
              {vault?.vaultPath ? 'Change vault folder' : 'Choose vault folder'}
            </Button>
            <Button
              variant="secondary"
              loading={vaultBusy}
              disabled={vaultBusy || !vault?.vaultPath}
              onClick={() => void syncVault()}
            >
              <RefreshCw className="size-4" />
              Sync now
            </Button>
            {vault?.notes != null && <Badge tone="neutral">{vault.notes} notes</Badge>}
          </div>
          {vault?.vaultPath && (
            <p className="truncate text-xs text-faint" title={vault.vaultPath}>
              {vault.vaultPath}
            </p>
          )}
        </div>
      </Card>
      )}

      {active === 'data' && (
      <Card
        title={
          <span className="flex items-center gap-2">
            <HardDriveDownload className="size-4" />
            Data &amp; backups
          </span>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Export your story bank to a portable JSON file, import one back in (experiences are added,
            never overwritten), or snapshot the whole database to a single file you can tuck away.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={dataBusy} onClick={() => void exportBank()}>
              <Download className="size-4" />
              Export bank (JSON)
            </Button>
            <Button variant="secondary" disabled={dataBusy} onClick={() => void importBank()}>
              <Upload className="size-4" />
              Import bank (JSON)
            </Button>
            <Button variant="secondary" disabled={dataBusy} onClick={() => void backupDb()}>
              <HardDriveDownload className="size-4" />
              Back up database
            </Button>
          </div>
        </div>
      </Card>
      )}

      {active === 'reminders' && (
      <Card
        title={
          <span className="flex items-center gap-2">
            <Bell className="size-4" />
            Reminders &amp; startup
          </span>
        }
      >
        {prefs === null ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-4">
            <Toggle
              label="Remind me to bank a fresh story"
              checked={prefs.reminderEnabled}
              onCheckedChange={(v) => void savePrefs({ reminderEnabled: v })}
            />
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink">Remind after this many days idle</span>
              <Input
                type="number"
                min={1}
                max={365}
                className="w-24"
                value={String(prefs.reminderIntervalDays)}
                disabled={!prefs.reminderEnabled}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n) && n >= 1 && n <= 365) void savePrefs({ reminderIntervalDays: n })
                }}
              />
            </label>
            <Toggle
              label="Launch STARfolio at login"
              checked={prefs.launchAtLogin}
              onCheckedChange={(v) => void savePrefs({ launchAtLogin: v })}
            />
            <Toggle
              label="Keep running in the tray when closed"
              checked={prefs.trayResident}
              onCheckedChange={(v) => void savePrefs({ trayResident: v })}
            />
          </div>
        )}
      </Card>
      )}

      {active === 'appearance' && (
      <Card
        title={
          <span className="flex items-center gap-2">
            <Palette className="size-4" />
            Appearance
          </span>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Choose how STARfolio looks. System follows your OS light/dark setting.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const selected = themeMode === opt.mode
              return (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setThemeMode(opt.mode)}
                  aria-pressed={selected}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-sm font-semibold transition-colors',
                    selected
                      ? 'border-fg-brand bg-raised text-ink'
                      : 'border-line text-muted hover:bg-raised/50 hover:text-ink'
                  )}
                >
                  <Icon className="size-5" />
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      </Card>
      )}

      {active === 'spend' && (
      <Card
        title={
          <span className="flex items-center gap-2">
            <Coins className="size-4" />
            Spend
          </span>
        }
        action={
          usage && usage.totalCalls > 0 ? (
            <Badge tone="neutral">{formatCost(usage.totalCost)} est.</Badge>
          ) : null
        }
      >
        {usage === null ? (
          <Skeleton className="h-24 w-full" />
        ) : usage.totalCalls === 0 ? (
          <p className="text-sm text-muted">
            No AI usage yet. Once you run a brain dump or practice session, an estimated cost
            breakdown by feature shows up here.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Estimated Anthropic API spend since you started, by feature. Based on public per-token
              pricing — treat it as a guide, not a bill.
            </p>
            <div className="space-y-3">
              {usage.byFeature.map((f) => (
                <div key={f.feature} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold text-ink">
                      {FEATURE_LABELS[f.feature] ?? f.feature}
                    </span>
                    <span className="tabular-nums text-ink">{formatCost(f.cost)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>{f.calls === 1 ? '1 call' : `${f.calls} calls`}</span>
                    <span className="tabular-nums">
                      {(f.inTokens + f.outTokens + f.cacheReadTokens).toLocaleString()} tokens
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full rounded-full bg-fg-brand"
                      style={{
                        width: `${usage.totalCost > 0 ? Math.max(2, (f.cost / usage.totalCost) * 100) : 0}%`
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-baseline justify-between gap-2 border-t border-line pt-3 text-sm font-semibold text-ink">
              <span>Total</span>
              <span className="tabular-nums">{formatCost(usage.totalCost)}</span>
            </div>
          </div>
        )}
      </Card>
      )}

      {active === 'updates' && (
      <Card
        title={
          <span className="flex items-center gap-2">
            <RefreshCw className="size-4" />
            Updates
          </span>
        }
        action={appVersion ? <Badge tone="neutral">v{appVersion}</Badge> : null}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            STARfolio updates itself from GitHub Releases. It isn&apos;t code-signed, so the first
            install shows a SmartScreen warning — updates after that are trusted automatically.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              loading={update.state === 'checking'}
              disabled={update.state === 'checking' || update.state === 'downloading'}
              onClick={checkUpdate}
            >
              <RefreshCw className="size-4" />
              Check for updates
            </Button>
            {update.state === 'available' && (
              <Button onClick={downloadUpdate}>
                <Download className="size-4" />
                Download v{update.version}
              </Button>
            )}
            {update.state === 'downloaded' && (
              <Button onClick={installUpdate}>
                Restart to install v{update.version}
              </Button>
            )}
          </div>
          {update.state === 'not-available' && (
            <p className="text-sm text-fg-success">You&apos;re on the latest version.</p>
          )}
          {update.state === 'downloading' && (
            <p className="text-sm text-muted">Downloading… {update.percent}%</p>
          )}
          {update.state === 'error' && (
            <p className="text-sm text-fg-danger">{update.message}</p>
          )}
        </div>
      </Card>
      )}
        </div>
      </div>
    </div>
  )
}
