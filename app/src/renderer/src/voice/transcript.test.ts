import { describe, expect, it } from 'vitest'
import { splitTranscript } from './transcript'
import type { TranscriptEvent } from '../lib/bank-types'

const ev = (text: string, stableUpTo: number, isFinal = false): TranscriptEvent => ({
  text,
  stableUpTo,
  isFinal
})

describe('splitTranscript', () => {
  it('returns empty parts for null', () => {
    expect(splitTranscript(null)).toEqual({ stable: '', tail: '' })
  })

  it('splits stable prefix from tail at stableUpTo', () => {
    expect(splitTranscript(ev('hello world', 5))).toEqual({ stable: 'hello', tail: ' world' })
  })

  it('keeps the tail leading space (join separator) so render must not add one', () => {
    const { stable, tail } = splitTranscript(ev('stable tail', 6))
    expect(stable).toBe('stable')
    expect(tail).toBe(' tail')
    expect(stable + tail).toBe('stable tail')
  })

  it('all-stable when stableUpTo covers the whole text', () => {
    expect(splitTranscript(ev('done', 4, true))).toEqual({ stable: 'done', tail: '' })
  })

  it('all-tail when nothing is stable yet', () => {
    expect(splitTranscript(ev('unstable', 0))).toEqual({ stable: '', tail: 'unstable' })
  })

  it('clamps out-of-range stableUpTo', () => {
    expect(splitTranscript(ev('abc', 99))).toEqual({ stable: 'abc', tail: '' })
    expect(splitTranscript(ev('abc', -5))).toEqual({ stable: '', tail: 'abc' })
  })
})
