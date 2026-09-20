import { describe, it } from 'vitest'
import type { TranscriptEvent } from './types'
import { defineSyntheticOrganicProperty, runProperty, fc } from '../pbt/pbt'
import { RollingTranscript } from './rolling-transcript'

interface Step {
  event: TranscriptEvent
  at: number
}

const step: fc.Arbitrary<Step> = fc.record({
  event: fc.record({
    text: fc.string({ maxLength: 8 }),
    stableUpTo: fc.nat(),
    isFinal: fc.boolean()
  }),
  at: fc.nat({ max: 10_000 })
})

const steps = fc.array(step, { maxLength: 30 })

interface OracleSeg {
  text: string
  at: number
}

function oracle(schedule: Step[]): { segments: OracleSeg[]; live: string } {
  const segments: OracleSeg[] = []
  let live = ''
  for (const { event, at } of schedule) {
    const text = event.text.trim()
    if (event.isFinal) {
      if (text) segments.push({ text, at })
      live = ''
    } else {
      live = text
    }
  }
  return { segments, live }
}

function joinView(segs: OracleSeg[], live: string): string {
  const parts = segs.map((s) => s.text)
  if (live) parts.push(live)
  return parts.join(' ')
}

describe('RollingTranscript (PBT)', () => {
  it('full() reproduces an independent reducer over the delivered order', () => {
    runProperty(
      defineSyntheticOrganicProperty(
        'rolling/full-matches-oracle',
        '1',
        'full rolling transcript matches the independent reducer'
      ),
      steps,
      (schedule) => {
        const rt = new RollingTranscript()
        for (const { event, at } of schedule) rt.push(event, at)
        const { segments, live } = oracle(schedule)
        const view = rt.full()
        return view.segmentCount === segments.length && view.text === joinView(segments, live)
      }
    )
  })

  it('segmentCount never decreases as events arrive', () => {
    runProperty(
      defineSyntheticOrganicProperty(
        'rolling/segment-count-monotone',
        '1',
        'rolling transcript segment count never decreases'
      ),
      steps,
      (schedule) => {
        const rt = new RollingTranscript()
        let prev = 0
        for (const { event, at } of schedule) {
          rt.push(event, at)
          if (rt.segmentCount < prev) return false
          prev = rt.segmentCount
        }
        return true
      }
    )
  })

  it('recent(window,now) is exactly the committed segments inside the window', () => {
    const withWindow = fc.record({
      schedule: steps,
      windowMs: fc.nat({ max: 20_000 }),
      now: fc.nat({ max: 20_000 })
    })
    runProperty(
      defineSyntheticOrganicProperty(
        'rolling/recent-window-subset',
        '1',
        'recent transcript contains exactly committed segments in the window'
      ),
      withWindow,
      ({ schedule, windowMs, now }) => {
        const rt = new RollingTranscript()
        for (const { event, at } of schedule) rt.push(event, at)
        const { segments, live } = oracle(schedule)
        const inWindow = segments.filter((s) => s.at >= now - windowMs)
        const view = rt.recent(windowMs, now)
        if (view.segmentCount > rt.full().segmentCount) return false
        return view.segmentCount === inWindow.length && view.text === joinView(inWindow, live)
      }
    )
  })
})
