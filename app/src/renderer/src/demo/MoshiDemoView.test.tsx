// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import type { MoshiDemoEvent } from '../../../preload/index.d'
import { MoshiDemoView } from './MoshiDemoView'
import { initState } from '../../../main/ai/roadmap'
import { startRecording, type Recording, type StreamingRecordOptions } from '../audio/recorder'
import { playScriptedAudio } from './scripted-playback'

vi.mock('../audio/recorder', () => ({ startRecording: vi.fn() }))
vi.mock('./scripted-playback', () => ({ playScriptedAudio: vi.fn(async () => undefined) }))

let root: Root
let container: HTMLDivElement
let receive: (event: MoshiDemoEvent) => void
let releaseAudio: () => void
let holdResume = false
const start = vi.fn(async (): Promise<'moshi' | 'fixture'> => 'fixture')
const end = vi.fn(async () => undefined)
const audio = vi.fn()
const timing = vi.fn()
const scriptedTurnDone = vi.fn(async () => true)
const scriptedPlayback = playScriptedAudio as Mock<typeof playScriptedAudio>
const startStreamingRecording = startRecording as unknown as Mock<
  (options: StreamingRecordOptions) => Promise<Recording<void>>
>

beforeEach(async () => {
  start.mockClear()
  end.mockClear()
  audio.mockClear()
  timing.mockClear()
  scriptedTurnDone.mockClear()
  scriptedPlayback.mockReset()
  scriptedPlayback.mockResolvedValue(undefined)
  startStreamingRecording.mockReset()
  holdResume = false
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('React', React)
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running'
      currentTime = 0
      destination = {}
      getOutputTimestamp(): { contextTime: number; performanceTime: number } {
        return { contextTime: 0, performanceTime: 0 }
      }
      createBuffer(_channels: number, length: number, sampleRate: number) {
        return { duration: length / sampleRate, copyToChannel: vi.fn() }
      }
      createBufferSource() {
        return { buffer: null, connect: vi.fn(), start: vi.fn() }
      }
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
      timing,
      scriptedTurnDone,
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
        jobDescription=""
        onJobDescriptionChange={vi.fn()}
        candidateName="Test"
        onBack={vi.fn()}
        onHistory={vi.fn()}
      />
    )
  })
  for (const checkbox of [
    ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  ].slice(0, 2)) {
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

it('speaks fixed opening, sends silence during playback, then restores mic audio', async () => {
  start.mockResolvedValueOnce('moshi')
  let emitFrames!: StreamingRecordOptions['onFrames']
  startStreamingRecording.mockImplementationOnce(async (options) => {
    emitFrames = options.onFrames
    return { stop: async () => undefined }
  })
  let releaseSpeech!: () => void
  scriptedPlayback.mockImplementationOnce(() => new Promise((resolve) => { releaseSpeech = resolve }))

  await click('Start native interview')
  const id = startedSessionId()
  await act(async () => {
    receive({
      type: 'scripted-turn', sessionId: id, revision: 1, kind: 'ask_intro',
      text: 'Hello, thanks for joining me. Tell me about yourself.',
      samples: new Float32Array([0.1, 0.2])
    })
  })
  expect(scriptedPlayback).toHaveBeenCalledWith(expect.anything(), new Float32Array([0.1, 0.2]), expect.any(Number), expect.anything())
  const samples = new Float32Array([0.2, 0.4])
  emitFrames(samples)
  expect(audio).toHaveBeenLastCalledWith(id, new Float32Array(2))
  expect(scriptedTurnDone).not.toHaveBeenCalled()

  await act(async () => releaseSpeech())
  expect(scriptedTurnDone).toHaveBeenCalledWith(id, 1)
  emitFrames(samples)
  expect(audio).toHaveBeenLastCalledWith(id, samples)
})

it('keeps microphone silent before opening playback arrives', async () => {
  start.mockResolvedValueOnce('moshi')
  let emitFrames!: StreamingRecordOptions['onFrames']
  startStreamingRecording.mockImplementationOnce(async (options) => {
    emitFrames = options.onFrames
    return { stop: async () => undefined }
  })
  await click('Start native interview')
  const id = startedSessionId()
  emitFrames(new Float32Array([0.3, 0.5]))
  expect(audio).toHaveBeenLastCalledWith(id, new Float32Array(2))
})

it('asks fixed final question and signs off before ending', async () => {
  start.mockResolvedValueOnce('moshi')
  startStreamingRecording.mockResolvedValueOnce({ stop: async () => undefined })
  await click('Start native interview')
  const id = startedSessionId()
  await completeOpening(id)
  await act(async () => {
    receive({
      type: 'scripted-turn', sessionId: id, revision: 3, kind: 'closing',
      text: 'That covers my questions. What questions do you have for me?',
      samples: new Float32Array([0.3, 0.4])
    })
  })
  expect(scriptedPlayback).toHaveBeenCalledWith(expect.anything(), new Float32Array([0.3, 0.4]), expect.any(Number), expect.anything())
  expect(scriptedTurnDone).toHaveBeenCalledWith(id, 3)
  expect(end).not.toHaveBeenCalled()
  await act(async () => {
    receive({
      type: 'scripted-turn', sessionId: id, revision: 4, kind: 'done',
      text: 'Thank you for your time. That concludes the interview.',
      samples: new Float32Array([0.5, 0.6])
    })
  })
  expect(scriptedPlayback).toHaveBeenCalledWith(expect.anything(), new Float32Array([0.5, 0.6]), expect.any(Number), expect.anything())
  expect(scriptedTurnDone).toHaveBeenCalledWith(id, 4)
  expect(end).toHaveBeenCalledWith(id, undefined)
})

it('waits for microphone readiness before speaking queued opening', async () => {
  start.mockResolvedValueOnce('moshi')
  let finishStart!: (recording: Recording<void>) => void
  startStreamingRecording.mockImplementationOnce(() => new Promise((resolve) => { finishStart = resolve }))
  await click('Start native interview')
  const id = startedSessionId()
  await act(async () => {
    receive({
      type: 'scripted-turn', sessionId: id, revision: 1, kind: 'ask_intro',
      text: 'Hello, thanks for joining me. Tell me about yourself.',
      samples: new Float32Array([0.1, 0.2])
    })
  })
  expect(scriptedPlayback).not.toHaveBeenCalled()
  await act(async () => finishStart({ stop: async () => undefined }))
  expect(scriptedPlayback).toHaveBeenCalledOnce()
  expect(scriptedTurnDone).toHaveBeenCalledWith(id, 1)
})

it('does not acknowledge cancelled opening speech', async () => {
  start.mockResolvedValueOnce('moshi')
  startStreamingRecording.mockResolvedValueOnce({ stop: async () => undefined })
  let rejectSpeech!: (error: Error) => void
  scriptedPlayback.mockImplementationOnce(() => new Promise((_, reject) => { rejectSpeech = reject }))
  await click('Start native interview')
  const id = startedSessionId()
  await act(async () => {
    receive({
      type: 'scripted-turn', sessionId: id, revision: 1, kind: 'ask_intro',
      text: 'Hello, thanks for joining me. Tell me about yourself.',
      samples: new Float32Array([0.1, 0.2])
    })
  })
  await click('End interview')
  await act(async () => rejectSpeech(new Error('Scripted speech cancelled')))
  expect(scriptedTurnDone).not.toHaveBeenCalled()
  expect(end).toHaveBeenCalledWith(id, undefined)
})

it('keeps raw interview media off unless separately selected', async () => {
  const media = [...container.querySelectorAll('label')].find((label) =>
    label.textContent?.includes('Save raw interview audio')
  )
  expect(media).toBeDefined()
  const checkbox = media!.querySelector('input')!
  expect(checkbox.checked).toBe(false)
  await click('Start native interview')
  expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ recordTrialMedia: false }))
  await click('End interview')
  await act(async () =>
    receive({ type: 'ended', reason: 'finished', sessionId: startedSessionId() })
  )
  await act(async () => checkbox.click())
  await click('Start native interview')
  expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ recordTrialMedia: true }))
})

function findButton(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((node) => node.textContent === label)
}

function startedSessionId(call = 0): string {
  return (start.mock.calls[call] as unknown as [{ sessionId: string }])[0].sessionId
}

async function completeOpening(id: string): Promise<void> {
  await act(async () => {
    receive({
      type: 'scripted-turn', sessionId: id, revision: 1, kind: 'ask_intro',
      text: 'Hello, thanks for joining me. Tell me about yourself.',
      samples: new Float32Array([0.1, 0.2])
    })
  })
  expect(scriptedTurnDone).toHaveBeenCalledWith(id, 1)
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
  await completeOpening(startedSessionId())
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

it('sends live speech timing before closing the trial', async () => {
  start.mockResolvedValueOnce('moshi')
  let emitFrames!: StreamingRecordOptions['onFrames']
  startStreamingRecording.mockImplementationOnce(async (options) => {
    emitFrames = options.onFrames
    return { stop: async () => undefined }
  })

  await click('Start native interview')
  const id = startedSessionId()
  await completeOpening(id)
  emitFrames(new Float32Array(240).fill(0.4), {
    startSample: 0,
    endSample: 240,
    observedAtMs: 100,
    estimatedEndAtMs: 100,
    uncertaintyMs: null
  })
  await click('End interview')

  expect(timing).toHaveBeenCalledWith(id, expect.objectContaining({ kind: 'mic-ready' }))
  expect(timing).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ kind: 'candidate-speech-start', sampleOffset: 0 })
  )
  expect(timing).toHaveBeenCalledWith(id, expect.objectContaining({ kind: 'session-ended' }))
  expect(timing.mock.invocationCallOrder.at(-1)).toBeLessThan(end.mock.invocationCallOrder[0])
})

it('does not treat an uninitialized output clock as playback time', async () => {
  start.mockResolvedValueOnce('moshi')
  startStreamingRecording.mockResolvedValueOnce({ stop: async () => undefined })

  await click('Start native interview')
  const id = startedSessionId()
  await act(async () => {
    receive({ type: 'audio', sessionId: id, samples: new Float32Array(240).fill(0.4) })
  })

  expect(timing).toHaveBeenCalledWith(
    id,
    expect.objectContaining({
      kind: 'assistant-voice-scheduled',
      estimatedAtMs: expect.any(Number),
      clockSource: 'renderer-fallback'
    })
  )
  const voice = timing.mock.calls.find(([, event]) => event.kind === 'assistant-voice-scheduled')![1]
  expect(voice.estimatedAtMs).toBeGreaterThan(0)
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
  await completeOpening(id)
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
