import { useEffect, useState } from 'react'
import { Cpu, Check, Trash2 } from 'lucide-react'
import type { Prefs, Provider } from '../../../preload/index.d'
import { Badge, Button, Card, Input, Select, Skeleton, useToast } from '../components'

type RoutedProvider = 'openai' | 'gemini'

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: 'Anthropic (cloud)',
  openai: 'OpenAI-compatible (local or hosted)',
  gemini: 'Google Gemini'
}

interface Tier {
  role: string
  label: string
  hint: string
  provider: keyof Prefs
  openaiModel: keyof Prefs
  geminiModel: keyof Prefs
}

const TIERS: Tier[] = [
  {
    role: 'conversation',
    label: 'Live conversation',
    hint: 'The voice the candidate hears every turn — fast, high volume. Biggest bill.',
    provider: 'providerConversation',
    openaiModel: 'openaiModelConversation',
    geminiModel: 'geminiModelConversation'
  },
  {
    role: 'evaluator',
    label: 'Answer evaluation',
    hint: 'Scores each answer and steers the next question.',
    provider: 'providerEvaluator',
    openaiModel: 'openaiModelEvaluator',
    geminiModel: 'geminiModelEvaluator'
  },
  {
    role: 'architect',
    label: 'Deep strategy',
    hint: 'Builds the interview roadmap once from the resume — heaviest single call.',
    provider: 'providerArchitect',
    openaiModel: 'openaiModelArchitect',
    geminiModel: 'geminiModelArchitect'
  }
]

export function ProviderSettings({
  prefs,
  onSave
}: {
  prefs: Prefs | null
  onSave: (patch: Partial<Prefs>) => Promise<void>
}): React.JSX.Element {
  const toast = useToast()
  const [keyState, setKeyState] = useState<Record<RoutedProvider, boolean | null>>({
    openai: null,
    gemini: null
  })
  const [keyInput, setKeyInput] = useState<Record<RoutedProvider, string>>({ openai: '', gemini: '' })
  const [keyBusy, setKeyBusy] = useState<RoutedProvider | null>(null)
  const [baseUrl, setBaseUrl] = useState('')

  async function refreshKeys(): Promise<void> {
    setKeyState({
      openai: await window.api.ai.providerHasKey('openai'),
      gemini: await window.api.ai.providerHasKey('gemini')
    })
  }

  useEffect(() => {
    void refreshKeys()
  }, [])

  const savedBaseUrl = prefs?.openaiBaseUrl
  useEffect(() => {
    if (savedBaseUrl !== undefined) setBaseUrl(savedBaseUrl)
  }, [savedBaseUrl])

  async function saveKey(p: RoutedProvider): Promise<void> {
    const value = keyInput[p].trim()
    if (!value) return
    setKeyBusy(p)
    try {
      await window.api.ai.providerSetKey(p, value)
      setKeyInput((s) => ({ ...s, [p]: '' }))
      await refreshKeys()
      toast(`${PROVIDER_LABELS[p]} key saved.`, 'success')
    } catch (err) {
      toast(`Could not save key: ${(err as Error).message}`, 'danger')
    } finally {
      setKeyBusy(null)
    }
  }

  async function removeKey(p: RoutedProvider): Promise<void> {
    setKeyBusy(p)
    try {
      await window.api.ai.providerDeleteKey(p)
      await refreshKeys()
      toast(`${PROVIDER_LABELS[p]} key removed.`, 'neutral')
    } catch (err) {
      toast(`Could not remove key: ${(err as Error).message}`, 'danger')
    } finally {
      setKeyBusy(null)
    }
  }

  function commitBaseUrl(): void {
    if (!prefs) return
    const v = baseUrl.trim()
    if (v && v !== prefs.openaiBaseUrl) void onSave({ openaiBaseUrl: v })
    else setBaseUrl(prefs.openaiBaseUrl)
  }

  const providers = prefs ? TIERS.map((t) => prefs[t.provider] as Provider) : []
  const usesOpenai = providers.includes('openai')
  const usesGemini = providers.includes('gemini')

  function keyField(p: RoutedProvider): React.JSX.Element {
    const saved = keyState[p]
    const optional = p === 'openai'
    return (
      <div key={p} className="space-y-2 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-muted">
            {PROVIDER_LABELS[p]} API key{optional ? ' (optional)' : ''}
          </span>
          {saved === null ? null : saved ? (
            <Badge tone="success">
              <Check className="size-3" />
              Saved
            </Badge>
          ) : (
            <Badge tone={optional ? 'neutral' : 'warning'}>Not set</Badge>
          )}
        </div>
        <p className="text-xs text-muted">
          {optional
            ? 'Local servers like Ollama or LM Studio usually need no key — set one only for hosted OpenAI-compatible endpoints.'
            : 'Required for Google Gemini. Stored encrypted by the OS, never leaves your machine except in calls to Google.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="min-w-48 flex-1"
            placeholder={saved ? 'Replace key' : 'Paste your key'}
            value={keyInput[p]}
            onChange={(e) => setKeyInput((s) => ({ ...s, [p]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveKey(p)
            }}
          />
          <Button
            loading={keyBusy === p}
            disabled={keyBusy === p || !keyInput[p].trim()}
            onClick={() => void saveKey(p)}
          >
            Save
          </Button>
          {saved && (
            <Button variant="ghost" disabled={keyBusy === p} onClick={() => void removeKey(p)}>
              <Trash2 className="size-4" />
              Remove
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Cpu className="size-4" />
          Model providers
        </span>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-muted">
          Route each interview tier to its own model. Everything defaults to Anthropic — switch a
          tier to a local OpenAI-compatible server (Ollama, LM Studio, vLLM, llama.cpp) or Google
          Gemini to cut cost. The live-conversation tier runs most often, so it saves the most.
        </p>

        {prefs === null ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            {TIERS.map((t) => {
              const provider = prefs[t.provider] as Provider
              const modelKey = provider === 'gemini' ? t.geminiModel : t.openaiModel
              const model = (prefs[modelKey] as string) ?? ''
              const needsModel = provider !== 'anthropic'
              return (
                <div key={t.role} className="space-y-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">{t.label}</p>
                    <p className="text-xs text-muted">{t.hint}</p>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <Select
                      className="w-64"
                      value={provider}
                      onChange={(e) => void onSave({ [t.provider]: e.target.value } as Partial<Prefs>)}
                    >
                      {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                        <option key={p} value={p}>
                          {PROVIDER_LABELS[p]}
                        </option>
                      ))}
                    </Select>
                    {needsModel && (
                      <label className="min-w-0 flex-1 space-y-1">
                        <Input
                          className="min-w-48"
                          invalid={!model.trim()}
                          placeholder={provider === 'gemini' ? 'gemini-2.5-flash' : 'model id (e.g. llama3.1)'}
                          value={model}
                          onChange={(e) => void onSave({ [modelKey]: e.target.value } as Partial<Prefs>)}
                        />
                        {!model.trim() && (
                          <span className="text-xs text-fg-danger">
                            Set a model id or this tier falls back to Anthropic.
                          </span>
                        )}
                      </label>
                    )}
                  </div>
                </div>
              )
            })}

            {usesOpenai && (
              <label className="block space-y-1 border-t border-line pt-4">
                <span className="text-sm font-semibold text-muted">OpenAI-compatible base URL</span>
                <Input
                  placeholder="http://localhost:11434/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  onBlur={commitBaseUrl}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitBaseUrl()
                  }}
                />
                <span className="text-xs text-faint">
                  Points every OpenAI-compatible tier at one endpoint — Ollama, LM Studio, vLLM,
                  llama.cpp, or a hosted server.
                </span>
              </label>
            )}

            {usesOpenai && keyField('openai')}
            {usesGemini && keyField('gemini')}
          </>
        )}
      </div>
    </Card>
  )
}
