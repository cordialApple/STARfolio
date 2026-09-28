// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components'
import { InterviewView } from './InterviewView'

const remoteMoshiEnabled = vi.hoisted(() => ({ value: false }))

vi.mock('../voice/useStreamingVoice', () => ({
  useStreamingVoice: () => ({
    listening: false,
    starting: false,
    partial: null,
    utteranceActive: false,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    clearError: vi.fn()
  })
}))

let root: Root
let container: HTMLDivElement
const startInterview = vi.fn(async (_input: unknown) => ({
  sessionId: 'session-1',
  utterance: 'Tell me about yourself.',
  action: { kind: 'ask_intro' },
  phase: 'intro',
  done: false,
  report: null
}))

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('React', React)
  Object.assign(HTMLElement.prototype, { scrollIntoView: vi.fn() })
  remoteMoshiEnabled.value = false
  startInterview.mockClear()
  window.api = {
    prefs: {
      get: async () => ({
        voiceModel: 'base.en',
        experimentalRemoteMoshiEnabled: remoteMoshiEnabled.value
      })
    },
    voice: {
      models: async () => [],
      onModelStatus: () => vi.fn()
    },
    ai: {
      onToken: () => vi.fn(),
      onDone: () => vi.fn()
    },
    interview: {
      start: startInterview
    }
  } as unknown as typeof window.api
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container.remove()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  vi.unstubAllGlobals()
})

async function renderInterview(): Promise<void> {
  root = createRoot(container)
  await act(async () => {
    root.render(
      <ToastProvider>
        <InterviewView />
      </ToastProvider>
    )
  })
}

it('hides the remote Moshi interview when the experiment is disabled', async () => {
  await renderInterview()
  expect(container.textContent).not.toContain('Native duplex (remote MoshiRAG)')
})

it('shows the remote Moshi interview when the experiment is enabled', async () => {
  remoteMoshiEnabled.value = true
  await renderInterview()
  expect(container.textContent).toContain('Native duplex (remote MoshiRAG)')
})

it('sends the target JD with resume for a text interview', async () => {
  await renderInterview()
  const jd = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Job description"]')
  expect(jd).not.toBeNull()
  await act(async () => {
    const sample = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Try a sample')
    )
    sample!.click()
  })
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      jd,
      'Own Kubernetes operations.'
    )
    jd!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    const start = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Start interview'
    )
    start!.click()
  })
  expect(startInterview).toHaveBeenCalledWith(
    expect.objectContaining({ jobDescription: 'Own Kubernetes operations.' })
  )
})
