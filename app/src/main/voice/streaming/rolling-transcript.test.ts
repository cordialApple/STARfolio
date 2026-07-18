import { describe, expect, it } from 'vitest'
import { RollingTranscript } from './rolling-transcript'
import type { TranscriptEvent } from './types'

const ev = (text: string, isFinal: boolean): TranscriptEvent => ({
  text,
  stableUpTo: isFinal ? text.length : 0,
  isFinal
})

describe('RollingTranscript', () => {
  it('starts empty', () => {
    const rt = new RollingTranscript()
    expect(rt.full()).toEqual({ text: '', segmentCount: 0, livePartial: '' })
  })

  it('holds the live partial without committing it', () => {
    const rt = new RollingTranscript()
    rt.push(ev('tell me about', false), 0)
    expect(rt.full()).toEqual({ text: 'tell me about', segmentCount: 0, livePartial: 'tell me about' })
  })

  it('commits a final segment and clears the live partial', () => {
    const rt = new RollingTranscript()
    rt.push(ev('tell me', false), 0)
    rt.push(ev('tell me about the outage', true), 10)
    expect(rt.full()).toEqual({
      text: 'tell me about the outage',
      segmentCount: 1,
      livePartial: ''
    })
  })

  it('accumulates finals across turns joined by a space', () => {
    const rt = new RollingTranscript()
    rt.push(ev('first answer', true), 0)
    rt.push(ev('second answer', true), 100)
    expect(rt.full().text).toBe('first answer second answer')
    expect(rt.full().segmentCount).toBe(2)
  })

  it('appends the in-progress partial after committed finals', () => {
    const rt = new RollingTranscript()
    rt.push(ev('first answer', true), 0)
    rt.push(ev('and then', false), 100)
    expect(rt.full()).toEqual({
      text: 'first answer and then',
      segmentCount: 1,
      livePartial: 'and then'
    })
  })

  it('ignores empty or whitespace-only finals', () => {
    const rt = new RollingTranscript()
    rt.push(ev('   ', true), 0)
    rt.push(ev('', true), 10)
    expect(rt.full()).toEqual({ text: '', segmentCount: 0, livePartial: '' })
  })

  it('trims surrounding whitespace on commit', () => {
    const rt = new RollingTranscript()
    rt.push(ev('  padded  ', true), 0)
    expect(rt.full().text).toBe('padded')
  })

  it('recent() keeps only committed segments inside the window plus the live partial', () => {
    const rt = new RollingTranscript()
    rt.push(ev('old', true), 1000)
    rt.push(ev('recent', true), 20000)
    rt.push(ev('live tail', false), 21000)
    const view = rt.recent(15000, 22000)
    expect(view.text).toBe('recent live tail')
    expect(view.segmentCount).toBe(1)
    expect(view.livePartial).toBe('live tail')
  })

  it('recent() keeps a segment landing exactly on the cutoff (inclusive window)', () => {
    const rt = new RollingTranscript()
    rt.push(ev('on cutoff', true), 5000)
    rt.push(ev('one ms older', true), 4999)
    const view = rt.recent(15000, 20000)
    expect(view.text).toBe('on cutoff')
    expect(view.segmentCount).toBe(1)
  })

  it('recent() returns just the live partial when all finals are stale', () => {
    const rt = new RollingTranscript()
    rt.push(ev('ancient', true), 0)
    rt.push(ev('typing', false), 30000)
    expect(rt.recent(15000, 30000)).toEqual({
      text: 'typing',
      segmentCount: 0,
      livePartial: 'typing'
    })
  })

  it('reset clears committed segments and the live partial', () => {
    const rt = new RollingTranscript()
    rt.push(ev('answer', true), 0)
    rt.push(ev('partial', false), 10)
    rt.reset()
    expect(rt.full()).toEqual({ text: '', segmentCount: 0, livePartial: '' })
    expect(rt.segmentCount).toBe(0)
  })
})
