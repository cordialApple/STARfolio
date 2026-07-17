import { describe, expect, it } from 'vitest'
import { partialToDelta } from './relay'

describe('partialToDelta', () => {
  it('emits only the newly-grown suffix per cumulative snapshot', () => {
    const tokens: string[] = []
    let dones = 0
    const relay = partialToDelta(
      (d) => tokens.push(d),
      () => (dones += 1)
    )
    relay({ text: 'Tell', done: false })
    relay({ text: 'Tell me', done: false })
    relay({ text: 'Tell me more.', done: true })
    expect(tokens).toEqual(['Tell', ' me', ' more.'])
    expect(tokens.join('')).toBe('Tell me more.')
    expect(dones).toBe(1)
  })

  it('flushes residual delta before done for a single sealed partial (stub path)', () => {
    const tokens: string[] = []
    let dones = 0
    const relay = partialToDelta(
      (d) => tokens.push(d),
      () => (dones += 1)
    )
    relay({ text: 'stub reply', done: true })
    expect(tokens).toEqual(['stub reply'])
    expect(dones).toBe(1)
  })

  it('skips empty deltas without a token emit', () => {
    const tokens: string[] = []
    let dones = 0
    const relay = partialToDelta(
      (d) => tokens.push(d),
      () => (dones += 1)
    )
    relay({ text: 'Hi', done: false })
    relay({ text: 'Hi', done: false })
    relay({ text: 'Hi', done: true })
    expect(tokens).toEqual(['Hi'])
    expect(dones).toBe(1)
  })

  it('emits done with no tokens when sealed empty (refusal analog)', () => {
    const tokens: string[] = []
    let dones = 0
    const relay = partialToDelta(
      (d) => tokens.push(d),
      () => (dones += 1)
    )
    relay({ text: '', done: true })
    expect(tokens).toEqual([])
    expect(dones).toBe(1)
  })
})
