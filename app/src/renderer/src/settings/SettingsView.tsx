import { useEffect, useState } from 'react'
import { KeyRound, Check, Trash2, ExternalLink, GitBranch, Share2 } from 'lucide-react'
import { Badge, Button, Card, Input, Skeleton, useToast } from '../components'

export function SettingsView(): React.JSX.Element {
  const toast = useToast()
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasPat, setHasPat] = useState<boolean | null>(null)
  const [pat, setPat] = useState('')
  const [patBusy, setPatBusy] = useState(false)
  const [graphBusy, setGraphBusy] = useState(false)

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
  }
  useEffect(() => {
    void refresh()
  }, [])

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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Settings</h1>
        <p className="text-sm text-muted">Your key and data stay on this machine.</p>
      </div>

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
    </div>
  )
}
