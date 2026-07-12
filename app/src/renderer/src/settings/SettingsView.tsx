import { useEffect, useState } from 'react'
import { KeyRound, Check, Trash2, ExternalLink } from 'lucide-react'
import { Badge, Button, Card, Input, Skeleton, useToast } from '../components'

export function SettingsView(): React.JSX.Element {
  const toast = useToast()
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh(): Promise<void> {
    setHasKey(await window.api.ai.hasKey())
  }
  useEffect(() => {
    void refresh()
  }, [])

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
    </div>
  )
}
