import React, { useEffect, useRef, useState } from 'react'
import { Database, Mic, Send, Sparkles } from 'lucide-react'
import { startRecording, type Recording } from './audio/recorder'
import {
  Badge,
  Button,
  Card,
  Input,
  StarRail,
  Textarea,
  ThemeToggle,
  useToast
} from './components'

function App(): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [prompt, setPrompt] = useState('Say hello in three words.')
  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [dbResult, setDbResult] = useState('')
  const [embedResult, setEmbedResult] = useState('')
  const [transcript, setTranscript] = useState('')
  const [recording, setRecording] = useState(false)
  const activeId = useRef<string | null>(null)
  const rec = useRef<Recording | null>(null)
  const toast = useToast()

  useEffect(() => {
    window.api.ai.hasKey().then(setHasKey)
    const offToken = window.api.ai.onToken((id, token) => {
      if (id === activeId.current) setOutput((prev) => prev + token)
    })
    const offDone = window.api.ai.onDone((id) => {
      if (id === activeId.current) setStreaming(false)
    })
    const offError = window.api.ai.onError((id, msg) => {
      if (id === activeId.current) {
        setOutput(`Error: ${msg}`)
        setStreaming(false)
      }
    })
    return () => {
      offToken()
      offDone()
      offError()
    }
  }, [])

  async function saveKey(): Promise<void> {
    try {
      await window.api.ai.setKey(apiKey)
      setHasKey(true)
      toast('API key saved to your OS credential store.', 'success')
    } finally {
      setApiKey('')
    }
  }

  async function runStream(): Promise<void> {
    setOutput('')
    setStreaming(true)
    const id = crypto.randomUUID()
    activeId.current = id
    await window.api.ai.stream(prompt, id)
  }

  async function runDbTest(): Promise<void> {
    const r = await window.api.db.selfTest()
    setDbResult(`ok=${r.ok} · fts=${r.fts} · knn=${r.knn}`)
  }

  async function runEmbedTest(): Promise<void> {
    setEmbedResult('embedding…')
    try {
      const r = await window.api.embed.selfTest()
      setEmbedResult(`ok=${r.ok} · dims=${r.dims} · knn=${r.knn}`)
    } catch (err) {
      setEmbedResult(`Error: ${(err as Error).message}`)
    }
  }

  async function startRec(): Promise<void> {
    setTranscript('')
    setRecording(true)
    rec.current = await startRecording()
  }

  async function stopRec(): Promise<void> {
    if (!rec.current) return
    setRecording(false)
    setTranscript('transcribing…')
    const pcm = await rec.current.stop()
    rec.current = null
    try {
      const text = await window.api.voice.transcribe(Array.from(pcm))
      setTranscript(text || '(no speech detected)')
    } catch (err) {
      setTranscript(`Error: ${(err as Error).message}`)
    }
  }

  return (
    <div className="min-h-screen bg-canvas px-6 py-10 text-ink">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StarRail filled={['s', 't', 'a', 'r']} variant="mark" className="[&>span]:size-4" />
            <div>
              <h1 className="text-2xl font-extrabold">STARfolio</h1>
              <p className="text-sm text-muted">Stage 0 spikes, on the design system</p>
            </div>
          </div>
          <ThemeToggle />
        </header>

        <Card
          title="API key"
          action={<Badge tone="neutral">safeStorage</Badge>}
        >
          {hasKey ? (
            <p className="text-sm font-semibold text-fg-success">Key stored in OS credential store</p>
          ) : (
            <div className="flex gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                placeholder="sk-ant-..."
              />
              <Button onClick={saveKey} disabled={!apiKey}>
                Save
              </Button>
            </div>
          )}
        </Card>

        <Card title="SQLite · sqlite-vec · FTS5">
          <Button variant="secondary" onClick={runDbTest}>
            <Database className="size-4" /> Run DB self-test
          </Button>
          {dbResult && <p className="mt-3 font-mono text-sm text-fg-success">{dbResult}</p>}
        </Card>

        <Card title="Embeddings">
          <Button variant="secondary" onClick={runEmbedTest}>
            <Sparkles className="size-4" /> Embed + KNN round-trip
          </Button>
          {embedResult && <p className="mt-3 font-mono text-sm text-fg-info">{embedResult}</p>}
        </Card>

        <Card title="Voice">
          <Button
            variant="secondary"
            onMouseDown={startRec}
            onMouseUp={stopRec}
            onMouseLeave={() => recording && stopRec()}
            onBlur={() => recording && stopRec()}
            onKeyDown={(e) => {
              if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !recording) {
                e.preventDefault()
                startRec()
              }
            }}
            onKeyUp={(e) => {
              if ((e.key === ' ' || e.key === 'Enter') && recording) {
                e.preventDefault()
                stopRec()
              }
            }}
          >
            <Mic className="size-4" />
            {recording ? 'Recording — release to transcribe' : 'Hold to record'}
          </Button>
          {transcript && (
            <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-raised p-3 text-sm text-ink">
              {transcript}
            </pre>
          )}
        </Card>

        <Card title="LLM stream">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            className="mb-3"
          />
          <Button onClick={runStream} loading={streaming} disabled={!hasKey || !prompt}>
            <Send className="size-4" /> {streaming ? 'Streaming' : 'Send'}
          </Button>
          {output && (
            <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-raised p-3 text-sm text-ink">
              {output}
            </pre>
          )}
        </Card>
      </div>
    </div>
  )
}

export default App
