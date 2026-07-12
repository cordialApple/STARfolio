import { useEffect, useState } from 'react'
import { KeyRound, Check, ExternalLink, Sparkles, ArrowRight } from 'lucide-react'
import { Button, Card, Input, StarRail, useToast } from '../components'

type Step = 'welcome' | 'key' | 'ready'

export function Onboarding({
  onStartBrainDump,
  onExplore
}: {
  onStartBrainDump: () => void
  onExplore: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [step, setStep] = useState<Step>('welcome')
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.ai.hasKey().then(setHasKey)
  }, [])

  async function finish(next: () => void): Promise<void> {
    try {
      await window.api.prefs.set({ onboardingDone: true })
    } catch {
      // marking onboarding complete is best-effort; never trap the user on this screen
    }
    next()
  }

  async function saveKey(): Promise<void> {
    const value = key.trim()
    if (!value) return
    setBusy(true)
    try {
      await window.api.ai.setKey(value)
      setKey('')
      setHasKey(true)
      toast('API key saved.', 'success')
      setStep('ready')
    } catch (err) {
      toast(`Could not save key: ${(err as Error).message}`, 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
        {step === 'welcome' && (
          <div className="space-y-6 text-center">
            <div className="flex justify-center">
              <StarRail filled={['s', 't', 'a', 'r']} variant="mark" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-extrabold tracking-tight">Welcome to STARfolio</h1>
              <p className="text-muted">
                Turn what you actually did at work into interview-ready STAR stories — captured by
                talking it out, kept on this machine, and yours.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button onClick={() => setStep('key')}>
                Get started
                <ArrowRight className="size-4" />
              </Button>
              <Button variant="ghost" onClick={() => void finish(onExplore)}>
                Skip
              </Button>
            </div>
          </div>
        )}

        {step === 'key' && (
          <Card
            title={
              <span className="flex items-center gap-2">
                <KeyRound className="size-4" />
                Connect your Anthropic key
              </span>
            }
          >
            <div className="space-y-4">
              <p className="text-sm text-muted">
                Brain dump, story generation, and live practice call the Anthropic API. Your key is
                stored encrypted by the OS and never leaves your machine except in calls to
                Anthropic. You can add or change it later in Settings.
              </p>

              {hasKey ? (
                <div className="flex items-center gap-2 rounded-lg bg-raised px-3 py-2 text-sm font-semibold text-fg-success">
                  <Check className="size-4" />
                  A key is already saved on this machine.
                </div>
              ) : (
                <label className="space-y-1">
                  <span className="text-sm font-semibold text-muted">Paste your key</span>
                  <Input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={key}
                    placeholder="sk-ant-…"
                    onChange={(e) => setKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveKey()
                    }}
                  />
                </label>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {hasKey ? (
                  <Button onClick={() => setStep('ready')}>
                    Continue
                    <ArrowRight className="size-4" />
                  </Button>
                ) : (
                  <>
                    <Button loading={busy} disabled={busy || !key.trim()} onClick={() => void saveKey()}>
                      Save key
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => setStep('ready')}>
                      Skip for now
                    </Button>
                  </>
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
            </div>
          </Card>
        )}

        {step === 'ready' && (
          <Card
            title={
              <span className="flex items-center gap-2">
                <Sparkles className="size-4" />
                Bank your first story
              </span>
            }
          >
            <div className="space-y-4">
              <p className="text-sm text-muted">
                The fastest start is a brain dump: talk (or type) through something you worked on,
                and STARfolio shapes it into a STAR story you can edit and keep. No blank forms.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void finish(onStartBrainDump)}>
                  Start a brain dump
                  <ArrowRight className="size-4" />
                </Button>
                <Button variant="ghost" onClick={() => void finish(onExplore)}>
                  I&apos;ll explore first
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
