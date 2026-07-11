import React, { useEffect, useRef, useState } from 'react'
import { startRecording, type Recording } from './audio/recorder'

function Card({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mb-4 w-full max-w-lg rounded-lg bg-gray-900 p-4">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

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
    await window.api.ai.setKey(apiKey)
    setHasKey(true)
    setApiKey('')
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
    <div className="min-h-screen bg-gray-950 p-8 text-white">
      <h1 className="mb-8 text-3xl font-bold">STARfolio — Stage 0 spikes</h1>

      <Card title="API Key (safeStorage)">
        {hasKey ? (
          <p className="text-sm text-green-400">Key stored in OS credential store</p>
        ) : (
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              placeholder="sk-ant-..."
              className="flex-1 rounded bg-gray-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={saveKey}
              disabled={!apiKey}
              className="rounded bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        )}
      </Card>

      <Card title="SQLite · sqlite-vec · FTS5">
        <button
          onClick={runDbTest}
          className="rounded bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500"
        >
          Run DB self-test
        </button>
        {dbResult && <p className="mt-3 text-sm text-emerald-300">{dbResult}</p>}
      </Card>

      <Card title="Embeddings (bge-small in a worker)">
        <button
          onClick={runEmbedTest}
          className="rounded bg-cyan-600 px-4 py-2 text-sm hover:bg-cyan-500"
        >
          Embed + KNN round-trip
        </button>
        {embedResult && <p className="mt-3 text-sm text-cyan-300">{embedResult}</p>}
      </Card>

      <Card title="Voice (whisper in a worker)">
        <button
          onMouseDown={startRec}
          onMouseUp={stopRec}
          onMouseLeave={() => recording && stopRec()}
          className="rounded bg-rose-600 px-4 py-2 text-sm hover:bg-rose-500"
        >
          {recording ? 'Recording — release to transcribe' : 'Hold to record'}
        </button>
        {transcript && <pre className="mt-3 whitespace-pre-wrap text-sm text-rose-200">{transcript}</pre>}
      </Card>

      <Card title="LLM stream (Haiku)">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          className="mb-3 w-full resize-none rounded bg-gray-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-purple-500"
        />
        <button
          onClick={runStream}
          disabled={!hasKey || streaming || !prompt}
          className="mb-3 rounded bg-purple-600 px-4 py-2 text-sm hover:bg-purple-500 disabled:opacity-40"
        >
          {streaming ? 'Streaming…' : 'Send'}
        </button>
        {output && <pre className="whitespace-pre-wrap rounded bg-gray-800 p-3 text-sm">{output}</pre>}
      </Card>
    </div>
  )
}

export default App
