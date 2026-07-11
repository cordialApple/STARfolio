import React, { useEffect, useState } from 'react'

function App(): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [prompt, setPrompt] = useState('Say hello in three words.')
  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)

  const activeId = React.useRef<string | null>(null)

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

  return (
    <div className="min-h-screen bg-gray-950 p-8 text-white">
      <h1 className="mb-8 text-3xl font-bold">STARfolio — Stage 0</h1>

      <section className="mb-6 max-w-lg rounded-lg bg-gray-900 p-4">
        <h2 className="mb-3 text-lg font-semibold">API Key</h2>
        {hasKey ? (
          <p className="text-sm text-green-400">Key stored</p>
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
      </section>

      <section className="max-w-lg rounded-lg bg-gray-900 p-4">
        <h2 className="mb-3 text-lg font-semibold">LLM Spike (Haiku)</h2>
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
        {output && (
          <pre className="whitespace-pre-wrap rounded bg-gray-800 p-3 text-sm">{output}</pre>
        )}
      </section>
    </div>
  )
}

export default App
