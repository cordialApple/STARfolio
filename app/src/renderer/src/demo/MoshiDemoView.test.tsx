// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import type { MoshiDemoEvent } from '../../../preload/index.d'
import { MoshiDemoView } from './MoshiDemoView'
import { initState } from '../../../main/ai/roadmap'
import { startRecording, type Recording, type StreamingRecordOptions } from '../audio/recorder'

vi.mock('../audio/recorder', () => ({ startRecording: vi.fn() }))

let root: Root
let container: HTMLDivElement
let receive: (event: MoshiDemoEvent) => void
let releaseAudio: () => void
let holdResume = false
const start = vi.fn(async (): Promise<'moshi' | 'fixture'> => 'fixture')
const end = vi.fn(async () => undefined)
const audio = vi.fn()
const startStreamingRecording = startRecording as unknown as Mock<
  (options: StreamingRecordOptions) => Promise<Recording<void>>
>

beforeEach(async () => {
  start.mockClear()
  end.mockClear()
  audio.mockClear()
  startStreamingRecording.mockReset()
  holdResume = false
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('React', React)
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running'
      resume(): Promise<void> {
        return holdResume
          ? new Promise((resolve) => {
              releaseAudio = resolve
            })
          : Promise.resolve()
      }
      close(): Promise<void> {
        this.state = 'closed'
        return Promise.resolve()
      }
    }
  )
  window.api = {
    bank: {
      list: async () => [
        { id: 'bank', title: 'Synthetic example', status: 'draft', snippet: 'Test fixture' }
      ]
    },
    moshiDemo: {
      start,
      end,
      audio,
      onEvent: (callback: (event: MoshiDemoEvent) => void) => {
        receive = callback
        return vi.fn()
      }
    }
  } as unknown as typeof window.api
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <MoshiDemoView
        resumeText="Synthetic resume"
        candidateName="Test"
        onBack={vi.fn()}
        onHistory={vi.fn()}
      />
    )
  })
  for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    await act(async () => {
      checkbox.click()
    })
  }
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
})

async function click(label: string): Promise<void> {
  const button = findButton(label)
  expect(button).toBeDefined()
  await act(async () => {
    button!.click()
  })
}

function findButton(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((node) => node.textContent === label)
}

function startedSessionId(call = 0): string {
  return (start.mock.calls[call] as unknown as [{ sessionId: string }])[0].sessionId
}

it('does not start a session after End while audio activation is pending', async () => {
  holdResume = true
  await click('Start native interview')
  await click('End interview')
  await act(async () => {
    releaseAudio()
  })
  expect(start).not.toHaveBeenCalled()
})

it('ignores the previous session end after another attempt starts', async () => {
  await click('Start native interview')
  const oldId = startedSessionId()
  await click('End interview')
  await act(async () => {
    receive({ type: 'ended', reason: 'finished', sessionId: oldId })
  })
  await click('Start native interview')
  await act(async () => {
    receive({ type: 'ended', reason: 'old disconnect', sessionId: oldId })
  })
  expect(container.textContent).toContain('Local fixture; no microphone or live models')
  expect(findButton('End interview')?.disabled).toBe(false)
  expect(start).toHaveBeenCalledTimes(2)
})

it('keeps report event ownership after End while scoring finishes', async () => {
  await click('Start native interview')
  const id = startedSessionId()
  await click('End interview')
  await act(async () => {
    receive({
      type: 'interview',
      sessionId: id,
      snapshot: {
        id: 'stored',
        candidateName: null,
        startedAtMs: 0,
        status: 'finished',
        mode: 'stub',
        state: initState({ topics: [], objectives: [] }),
        transcript: [],
        evaluations: [],
        conditioning: [],
        commandConformance: 'unverified',
        report: {
          overallFeedback: 'Report received after End',
          strengths: [],
          improvementAreas: [],
          starStories: []
        }
      }
    } as MoshiDemoEvent)
    receive({ type: 'ended', reason: 'finished', sessionId: id })
  })
  expect(container.textContent).toContain('Report received after End')
})

it('flushes final microphone frames before ending the remote session', async () => {
  start.mockResolvedValueOnce('moshi')
  let flushFrames!: (samples: Float32Array) => void
  let finishStop!: () => void
  const stop = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishStop = resolve
      })
  )
  startStreamingRecording.mockImplementationOnce(async (options) => {
    flushFrames = options.onFrames
    return { stop }
  })

  await click('Start native interview')
  await click('End interview')
  expect(stop).toHaveBeenCalledOnce()
  expect(end).not.toHaveBeenCalled()

  const trailing = new Float32Array([0.1, 0.2, 0.3])
  await act(async () => {
    flushFrames(trailing)
    finishStop()
  })

  expect(audio).toHaveBeenCalledWith(expect.any(String), trailing)
  expect(end).toHaveBeenCalledOnce()
  expect(audio.mock.invocationCallOrder[0]).toBeLessThan(end.mock.invocationCallOrder[0])
})

it('waits for pending microphone startup before ending the remote session', async () => {
  start.mockResolvedValueOnce('moshi')
  let finishStart!: (recording: { stop: () => Promise<void> }) => void
  const stop = vi.fn(async () => undefined)
  startStreamingRecording.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishStart = resolve
      })
  )

  await click('Start native interview')
  await vi.waitFor(() => expect(finishStart).toBeTypeOf('function'))
  await click('End interview')
  expect(end).not.toHaveBeenCalled()

  await act(async () => {
    finishStart({ stop })
  })

  expect(stop).toHaveBeenCalledOnce()
  expect(end).toHaveBeenCalledOnce()
  expect(stop.mock.invocationCallOrder[0]).toBeLessThan(end.mock.invocationCallOrder[0])
})

it('flushes final microphone frames before ending during unmount', async () => {
  start.mockResolvedValueOnce('moshi')
  let flushFrames!: (samples: Float32Array) => void
  let finishStop!: () => void
  const stop = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishStop = resolve
      })
  )
  startStreamingRecording.mockImplementationOnce(async (options) => {
    flushFrames = options.onFrames
    return { stop }
  })

  await click('Start native interview')
  const id = startedSessionId()
  await act(async () => {
    root.render(<div />)
  })
  expect(end).not.toHaveBeenCalled()

  const trailing = new Float32Array([0.4, 0.5])
  await act(async () => {
    flushFrames(trailing)
    finishStop()
  })

  expect(audio).toHaveBeenCalledWith(id, trailing)
  expect(end).toHaveBeenCalledWith(id, undefined)
  expect(audio.mock.invocationCallOrder[0]).toBeLessThan(end.mock.invocationCallOrder[0])
})

it('keeps the session owned until remote-ended audio finishes draining', async () => {
  start.mockResolvedValueOnce('moshi').mockResolvedValueOnce('fixture')
  let finishStop!: () => void
  const stop = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishStop = resolve
      })
  )
  startStreamingRecording.mockResolvedValueOnce({ stop })

  await click('Start native interview')
  const id = startedSessionId()
  await act(async () => {
    receive({ type: 'ended', reason: 'worker stopped', sessionId: id })
  })

  const startButton = findButton('Start native interview')
  expect(stop).toHaveBeenCalledOnce()
  expect(startButton?.disabled).toBe(true)
  await click('Start native interview')
  expect(start).toHaveBeenCalledOnce()

  await act(async () => {
    finishStop()
  })
  expect(startButton?.disabled).toBe(false)
  await click('Start native interview')
  expect(start).toHaveBeenCalledTimes(2)
})

it('ends the remote session and reports an incomplete interview when audio drain fails', async () => {
  start.mockResolvedValueOnce('moshi')
  const stop = vi.fn(async () => {
    throw new Error('microphone drain failed')
  })
  startStreamingRecording.mockResolvedValueOnce({ stop })

  await click('Start native interview')
  await click('End interview')

  await vi.waitFor(() => expect(end).toHaveBeenCalledOnce())
  expect(end).toHaveBeenCalledWith(expect.any(String), 'Final transcript flush failed')
  expect(container.textContent).toContain(
    'Interview ended incomplete because audio capture did not drain: microphone drain failed'
  )
})

it('preserves an audio drain rejection without an error value', async () => {
  start.mockResolvedValueOnce('moshi')
  const stop = vi.fn(() => Promise.reject())
  startStreamingRecording.mockResolvedValueOnce({ stop })

  await click('Start native interview')
  await click('End interview')

  await vi.waitFor(() =>
    expect(end).toHaveBeenCalledWith(expect.any(String), 'Final transcript flush failed')
  )
  expect(container.textContent).toContain(
    'Interview ended incomplete because audio capture did not drain: Unknown audio capture failure'
  )
})
