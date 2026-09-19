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

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('React', React)
  remoteMoshiEnabled.value = false
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
    }
  } as unknown as typeof window.api
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container.remove()
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
