import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../streaming/types'
import { TranscriptAssembler } from './mapping'
import { EOT_THRESHOLD, eotPrs, type OutMsg } from './protocol'

function eotStep(): OutMsg {
  return { type: 'Step', step_idx: 0, prs: eotPrs() }
}

function collect(): { events: TranscriptEvent[]; asm: TranscriptAssembler } {
  const events: TranscriptEvent[] = []
  const asm = new TranscriptAssembler({ onTranscript: (e) => events.push(e) })
  return { events, asm }
}

describe('TranscriptAssembler', () => {
  it('emits a non-final event per word with stableUpTo at text end', () => {
    const { events, asm } = collect()
    asm.handle({ type: 'Word', text: 'tell', start_time: 0 })
    asm.handle({ type: 'Word', text: 'me', start_time: 0.4 })
    expect(events).toEqual([
      { text: 'tell', stableUpTo: 4, isFinal: false },
      { text: 'tell me', stableUpTo: 7, isFinal: false }
    ])
  })

  it('every event has stableUpTo === text.length (all committed)', () => {
    const { events, asm } = collect()
    for (const w of ['a', 'bb', 'ccc']) asm.handle({ type: 'Word', text: w, start_time: 0 })
    for (const e of events) expect(e.stableUpTo).toBe(e.text.length)
  })

  it('end-of-turn step finalizes and resets the buffer', () => {
    const { events, asm } = collect()
    asm.handle({ type: 'Word', text: 'hello', start_time: 0 })
    asm.handle(eotStep())
    const final = events.at(-1)!
    expect(final).toEqual({ text: 'hello', stableUpTo: 5, isFinal: true })

    asm.handle({ type: 'Word', text: 'again', start_time: 1 })
    expect(events.at(-1)).toEqual({ text: 'again', stableUpTo: 5, isFinal: false })
  })

  it('ignores end-of-turn with no buffered words (debounce)', () => {
    const { events, asm } = collect()
    asm.handle(eotStep())
    asm.handle(eotStep())
    expect(events).toEqual([])
  })

  it('does not finalize on a non-EOT step', () => {
    const { events, asm } = collect()
    asm.handle({ type: 'Word', text: 'hi', start_time: 0 })
    asm.handle({ type: 'Step', step_idx: 1, prs: [0, 0, EOT_THRESHOLD] })
    expect(events.every((e) => !e.isFinal)).toBe(true)
  })

  it('routes side-channel sinks', () => {
    const seen: string[] = []
    const asm = new TranscriptAssembler({
      onTranscript: () => {},
      onReady: () => seen.push('ready'),
      onWord: (w) => seen.push(`word:${w.text}`),
      onEndOfTurn: () => seen.push('eot'),
      onDrained: (id) => seen.push(`drain:${id}`),
      onError: (m) => seen.push(`err:${m}`)
    })
    asm.handle({ type: 'Ready' })
    asm.handle({ type: 'Word', text: 'x', start_time: 0 })
    asm.handle(eotStep())
    asm.handle({ type: 'Marker', id: 7 })
    asm.handle({ type: 'Error', message: 'boom' })
    expect(seen).toEqual(['ready', 'word:x', 'eot', 'drain:7', 'err:boom'])
  })
})
