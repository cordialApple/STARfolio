import { describe, expect, it } from 'vitest'
import { UtteranceStream } from './stream'

function fixedClock(t = 0): { now: () => number; set: (v: number) => void } {
  let value = t
  return { now: () => value, set: (v) => (value = v) }
}

describe('UtteranceStream', () => {
  it('accumulates tokens in order', () => {
    const s = new UtteranceStream()
    s.push('Tell ')
    s.push('me ')
    const last = s.push('more.')
    expect(last.text).toBe('Tell me more.')
    expect(s.text()).toBe('Tell me more.')
  })

  it('trims leading and trailing whitespace but keeps interior', () => {
    const s = new UtteranceStream()
    s.push('\n  Walk me ')
    s.push('through it.  \n')
    expect(s.text()).toBe('Walk me through it.')
  })

  it('final trimmed text matches a plain concat + trim (parse-path contract)', () => {
    const tokens = ['  ', 'So,', ' what', ' broke?', ' ']
    const s = new UtteranceStream()
    for (const t of tokens) s.push(t)
    expect(s.text()).toBe(tokens.join('').trim())
  })

  it('ignores empty-string tokens as a no-op', () => {
    const s = new UtteranceStream()
    s.push('')
    expect(s.done).toBe(false)
    expect(s.idleMs(100)).toBe(0)
    expect(s.text()).toBe('')
  })

  it('marks done on finish and snapshots the sealed text', () => {
    const s = new UtteranceStream()
    s.push('Thanks.')
    const done = s.finish()
    expect(done.done).toBe(true)
    expect(done.text).toBe('Thanks.')
    expect(s.done).toBe(true)
  })

  it('ignores tokens pushed after finish (late token from an aborted stream)', () => {
    const s = new UtteranceStream()
    s.push('Good answer.')
    s.finish()
    const late = s.push(' Stray tail.')
    expect(late.text).toBe('Good answer.')
    expect(s.text()).toBe('Good answer.')
  })

  it('reports idle ms since the last token via the injected clock', () => {
    const clock = fixedClock(1_000)
    const s = new UtteranceStream({ now: clock.now })
    expect(s.idleMs(1_000)).toBe(0)
    s.push('Hmm')
    expect(s.idleMs(4_000)).toBe(3_000)
    clock.set(1_500)
    s.push(' okay')
    expect(s.idleMs(1_600)).toBe(100)
  })

  it('reports hasStarted only after the first real token', () => {
    const s = new UtteranceStream()
    expect(s.hasStarted).toBe(false)
    s.push('')
    expect(s.hasStarted).toBe(false)
    s.push('Hi')
    expect(s.hasStarted).toBe(true)
    s.reset()
    expect(s.hasStarted).toBe(false)
  })

  it('reset clears buffer, sealed, and timing', () => {
    const clock = fixedClock(500)
    const s = new UtteranceStream({ now: clock.now })
    s.push('scratch')
    s.finish()
    s.reset()
    expect(s.text()).toBe('')
    expect(s.done).toBe(false)
    expect(s.idleMs(9_999)).toBe(0)
    expect(s.push('fresh').text).toBe('fresh')
  })
})
