import { describe, expect, it } from 'vitest'
import {
  EnergyVad,
  defaultVadConfig,
  LocalAgreement,
  StreamWindow,
  RtfMeter,
  defaultWindowConfig,
  HalfDuplexGate,
  defaultHalfDuplexConfig,
  type VadEvent,
  type PartialTranscript
} from '../../src/main/voice/streaming'

function frame(value: number, n = 512): Float32Array {
  return new Float32Array(n).fill(value)
}
const speech = frame(0.1)
const silence = frame(0)

const FRAME_SAMPLES = 512
const FRAME_MS = (FRAME_SAMPLES / 16000) * 1000

function feed(vad: EnergyVad, f: Float32Array, count: number): VadEvent[] {
  const out: VadEvent[] = []
  for (let i = 0; i < count; i++) out.push(...vad.process(f))
  return out
}

describe('streaming pipeline: VAD over a realistic turn', () => {
  it('emits exactly one start then one end across silence→speech→pause→speech→silence', () => {
    const vad = new EnergyVad(defaultVadConfig())
    const events: VadEvent[] = []

    events.push(...feed(vad, silence, 8))
    events.push(...feed(vad, speech, 12))
    expect(vad.inUtterance).toBe(true)

    events.push(...feed(vad, silence, 30))
    expect(vad.inUtterance).toBe(true)

    events.push(...feed(vad, speech, 6))
    expect(vad.inUtterance).toBe(true)

    events.push(...feed(vad, silence, 40))
    expect(vad.inUtterance).toBe(false)

    expect(events).toEqual(['utteranceStart', 'utteranceEnd'])
  })

  it('a mid-turn pause shorter than the hangover never splits the turn', () => {
    const vad = new EnergyVad(defaultVadConfig())
    feed(vad, speech, 6)
    const midPause = feed(vad, silence, 39)
    expect(midPause).toEqual([])
    expect(vad.inUtterance).toBe(true)
  })
})

describe('streaming pipeline: LocalAgreement over a sliding-window turn', () => {
  const growing = [
    'so i',
    'so i built',
    'so i built a rest',
    'so i built a rest api',
    'so i built a rest api for',
    'so i built a rest api for the'
  ]
  const revisedTail = [
    'so i built a rest api for the team using',
    'so i built a rest api for the team using redis',
    'so i built a rest api for the team using postgres',
    'so i built a rest api for the team using postgres for'
  ]

  it('commits a monotonic prefix and never regresses stableUpTo across the turn', () => {
    const la = new LocalAgreement()
    const partials: PartialTranscript[] = []
    for (const h of [...growing, ...revisedTail]) partials.push(la.update(h))

    for (let i = 1; i < partials.length; i++) {
      expect(partials[i].stableUpTo).toBeGreaterThanOrEqual(partials[i - 1].stableUpTo)
    }
    for (const p of partials) {
      expect(p.text.slice(0, p.stableUpTo)).toBe(p.text.slice(0, p.stableUpTo).trimEnd())
      expect(p.text.startsWith(p.text.slice(0, p.stableUpTo))).toBe(true)
    }
  })

  it('a revised tail before commit does not corrupt the frozen prefix', () => {
    const la = new LocalAgreement()
    for (const h of growing) la.update(h)
    const committed = la.update(revisedTail[0])
    const afterRevision = la.update(revisedTail[2])
    expect(afterRevision.stableUpTo).toBeGreaterThanOrEqual(committed.stableUpTo)
    expect(afterRevision.text.startsWith('so i built a rest api for the')).toBe(true)
  })

  it('finalize commits the whole turn once endpointing fires', () => {
    const la = new LocalAgreement()
    for (const h of growing) la.update(h)
    const done = la.finalize('so i built a rest api for the payments team')
    expect(done.stableUpTo).toBe(done.text.length)
    expect(done.text).toBe('so i built a rest api for the payments team')
  })
})

describe('streaming pipeline: HalfDuplexGate gating the VAD input stream', () => {
  it('drops mic frames while TTS speaks and through the guard tail, so no utteranceStart fires', () => {
    const gate = new HalfDuplexGate(defaultHalfDuplexConfig({ guardMs: 250 }))
    const vad = new EnergyVad(defaultVadConfig())
    const events: VadEvent[] = []
    let dropped = 0
    let now = 0

    const pump = (f: Float32Array, count: number): void => {
      for (let i = 0; i < count; i++) {
        if (gate.captureOpen(now)) events.push(...vad.process(f))
        else dropped++
        now += FRAME_MS
      }
    }

    gate.onTtsStart()
    pump(speech, 20)
    expect(events).toEqual([])
    expect(vad.inUtterance).toBe(false)

    gate.onTtsEnd(now)
    const guardFrames = Math.ceil(250 / FRAME_MS)
    pump(speech, guardFrames)
    expect(events).toEqual([])
    expect(dropped).toBe(20 + guardFrames)

    pump(speech, 6)
    expect(events).toEqual(['utteranceStart'])
    expect(vad.inUtterance).toBe(true)
  })
})

describe('streaming pipeline: StreamWindow + RtfMeter over a 1s-tick decode loop', () => {
  function runLoop(ticks: number, decodeFraction: number): RtfMeter {
    const win = new StreamWindow(defaultWindowConfig())
    const meter = new RtfMeter()
    let decodes = 0
    for (let t = 0; t < ticks; t++) {
      win.append(frame(0.1, 16000))
      expect(win.shouldDecode()).toBe(true)
      const windowMs = win.windowMs
      meter.record(windowMs, windowMs * decodeFraction)
      win.markDecoded()
      expect(win.shouldDecode()).toBe(false)
      decodes++
    }
    expect(decodes).toBe(ticks)
    return meter
  }

  it('stays real-time when every decode is faster than its audio window', () => {
    const meter = runLoop(5, 0.5)
    expect(meter.meanRtf).toBeCloseTo(0.5)
    expect(meter.worstRtf).toBeCloseTo(0.5)
    expect(meter.realTime).toBe(true)
  })

  it('flags non-real-time the moment decode outpaces audio in the loop', () => {
    const meter = runLoop(5, 1.2)
    expect(meter.worstRtf).toBeCloseTo(1.2)
    expect(meter.realTime).toBe(false)
  })

  it('grows the window each tick until the decode-interval cadence, one decode per second of audio', () => {
    const win = new StreamWindow(defaultWindowConfig())
    win.append(frame(0.1, 8000))
    expect(win.shouldDecode()).toBe(false)
    win.append(frame(0.1, 8000))
    expect(win.shouldDecode()).toBe(true)
    expect(win.windowMs).toBe(1000)
  })
})
