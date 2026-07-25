import fc from 'fast-check'
import type { EntryInput, Speaker } from '../canonical'

const SPEAKERS: readonly Speaker[] = ['interviewer', 'candidate']

export const entryArb: fc.Arbitrary<EntryInput> = fc
  .record({
    speaker: fc.constantFrom(...SPEAKERS),
    text: fc.string({ minLength: 1 }),
    startMs: fc.integer({ min: 0, max: 60 * 60 * 1000 }),
    duration: fc.integer({ min: 0, max: 30 * 1000 }),
    truncated: fc.boolean()
  })
  .map(({ speaker, text, startMs, duration, truncated }) => ({
    speaker,
    text,
    startMs,
    endMs: startMs + duration,
    truncated
  }))

export const entriesArb: fc.Arbitrary<EntryInput[]> = fc.array(entryArb, { maxLength: 12 })

export const cleanTurnsArb: fc.Arbitrary<EntryInput[]> = fc
  .array(
    fc.record({
      text: fc.string({ minLength: 1 }),
      duration: fc.integer({ min: 1, max: 20 * 1000 }),
      gap: fc.integer({ min: 0, max: 5 * 1000 })
    }),
    { minLength: 1, maxLength: 10 }
  )
  .map((turns) => {
    let cursor = 0
    return turns.map((turn, i): EntryInput => {
      const startMs = cursor + turn.gap
      const endMs = startMs + turn.duration
      cursor = endMs
      return {
        speaker: i % 2 === 0 ? 'interviewer' : 'candidate',
        text: turn.text,
        startMs,
        endMs,
        truncated: false
      }
    })
  })

export { fc }
