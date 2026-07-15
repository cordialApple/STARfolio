import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { speak, stopSpeaking } from '../../src/renderer/src/lib/tts'

interface FakeSynth {
  speaking: boolean
  cancel: ReturnType<typeof vi.fn>
  speak: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
}

let synth: FakeSynth

function lastUtterance(): { text: string; onstart?: () => void; onend?: () => void } {
  return synth.speak.mock.calls.at(-1)![0]
}

beforeEach(() => {
  vi.useFakeTimers()
  synth = { speaking: false, cancel: vi.fn(), speak: vi.fn(), pause: vi.fn(), resume: vi.fn() }
  class Utterance {
    text: string
    rate = 0
    pitch = 0
    onstart?: () => void
    onend?: () => void
    onerror?: () => void
    constructor(text: string) {
      this.text = text
    }
  }
  vi.stubGlobal('window', { speechSynthesis: synth })
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
})

afterEach(() => {
  stopSpeaking()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('speak', () => {
  it('ignores empty or whitespace-only text', () => {
    speak('   ')
    expect(synth.cancel).not.toHaveBeenCalled()
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('cancels any in-flight utterance before speaking the new one', () => {
    speak('hello world')
    expect(synth.cancel).toHaveBeenCalledTimes(1)
    expect(synth.speak).toHaveBeenCalledTimes(1)
    expect(lastUtterance().text).toBe('hello world')
  })

  it('keeps a speaking utterance alive with periodic pause+resume', () => {
    speak('a long question')
    synth.speaking = true
    lastUtterance().onstart!()

    vi.advanceTimersByTime(14000)
    expect(synth.pause).toHaveBeenCalledTimes(1)
    expect(synth.resume).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(14000)
    expect(synth.pause).toHaveBeenCalledTimes(2)
  })

  it('stops the keep-alive once the utterance is no longer speaking', () => {
    speak('a long question')
    synth.speaking = true
    lastUtterance().onstart!()
    vi.advanceTimersByTime(14000)
    expect(synth.pause).toHaveBeenCalledTimes(1)

    synth.speaking = false
    vi.advanceTimersByTime(14000)
    vi.advanceTimersByTime(14000)
    expect(synth.pause).toHaveBeenCalledTimes(1)
  })

  it('tears down a running keep-alive when a new utterance starts', () => {
    speak('first')
    synth.speaking = true
    lastUtterance().onstart!()
    vi.advanceTimersByTime(14000)
    expect(synth.pause).toHaveBeenCalledTimes(1)

    speak('second')
    vi.advanceTimersByTime(14000)
    expect(synth.pause).toHaveBeenCalledTimes(1)
  })
})

describe('stopSpeaking', () => {
  it('cancels playback and clears the keep-alive', () => {
    speak('a long question')
    synth.speaking = true
    lastUtterance().onstart!()

    stopSpeaking()
    expect(synth.cancel).toHaveBeenCalled()

    const pausesBefore = synth.pause.mock.calls.length
    vi.advanceTimersByTime(14000)
    expect(synth.pause).toHaveBeenCalledTimes(pausesBefore)
  })
})
