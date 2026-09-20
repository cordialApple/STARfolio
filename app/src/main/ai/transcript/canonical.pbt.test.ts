import { describe, it } from 'vitest'
import { defineSyntheticOrganicProperty, runProperty } from '../../voice/pbt/pbt'
import { CanonicalTranscript, type EntryInput } from './canonical'
import { cleanTurnsArb, entriesArb } from './pbt/arbitraries'

const LABEL = { interviewer: 'Interviewer', candidate: 'Candidate' } as const

function build(inputs: EntryInput[]): CanonicalTranscript {
  const t = new CanonicalTranscript()
  for (const input of inputs) t.append(input)
  return t
}

function bruteOverlaps(t: CanonicalTranscript): number {
  const e = t.all()
  let n = 0
  for (let i = 0; i < e.length; i++) {
    for (let j = i + 1; j < e.length; j++) {
      const a = e[i]
      const b = e[j]
      if (a.speaker !== b.speaker && a.startMs < b.endMs && b.startMs < a.endMs) n++
    }
  }
  return n
}

describe('canonical transcript store (6d.2b)', () => {
  it('append is total for well-formed entries and records every one', () => {
    runProperty(
      defineSyntheticOrganicProperty(
        'transcript/totality',
        '1',
        'all well formed transcript entries are recorded'
      ),
      entriesArb,
      (inputs) => {
        const t = build(inputs)
        return t.length === inputs.length
      }
    )
  })

  it('the timeline stays sorted non-decreasing by startMs regardless of append order', () => {
    runProperty(
      defineSyntheticOrganicProperty(
        'transcript/sorted',
        '1',
        'transcript entries stay ordered by start time'
      ),
      entriesArb,
      (inputs) => {
        const e = build(inputs).all()
        for (let i = 1; i < e.length; i++) if (e[i].startMs < e[i - 1].startMs) return false
        return true
      }
    )
  })

  it('overlap query equals an independent brute-force cross-speaker intersection', () => {
    runProperty(
      defineSyntheticOrganicProperty(
        'transcript/overlap-correct',
        '1',
        'overlap detection matches cross speaker interval intersection'
      ),
      entriesArb,
      (inputs) => {
        const t = build(inputs)
        const brute = bruteOverlaps(t)
        return t.overlaps().length === brute && t.hasOverlap() === brute > 0
      }
    )
  })

  it('clean sequential turns never overlap and render with zero marker tokens', () => {
    runProperty(
      defineSyntheticOrganicProperty(
        'transcript/clean-no-markers',
        '1',
        'clean sequential turns render without overlap or truncation markers'
      ),
      cleanTurnsArb,
      (inputs) => {
        const rendered = build(inputs).render()
        return (
          !build(inputs).hasOverlap() &&
          !rendered.includes('(overlapping)') &&
          !rendered.includes('[cut off]')
        )
      }
    )
  })

  it('clean turns render as the plain speaker-prefixed join — the degenerate cascade view', () => {
    runProperty(
      defineSyntheticOrganicProperty(
        'transcript/clean-render-identity',
        '1',
        'clean turns render as the plain speaker prefixed join'
      ),
      cleanTurnsArb,
      (inputs) => {
        const expected = inputs.map((e) => `${LABEL[e.speaker]}: ${e.text.trim()}`).join('\n')
        return build(inputs).render() === expected
      }
    )
  })

  it('truncation is preserved verbatim — one marker per truncated entry', () => {
    runProperty(
      defineSyntheticOrganicProperty(
        'transcript/truncation-preserved',
        '1',
        'each truncated entry retains one truncation marker'
      ),
      entriesArb,
      (inputs) => {
        const rendered = build(inputs).render()
        const marks = rendered.split('[cut off]').length - 1
        return marks === inputs.filter((e) => e.truncated).length
      }
    )
  })
})
