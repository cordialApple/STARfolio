import { describe, expect, it } from 'vitest'
import {
  EnergyVad,
  defaultVadConfig,
  frameRms,
  LocalAgreement,
  StreamWindow,
  RtfMeter,
  defaultWindowConfig,
  HalfDuplexGate,
  defaultHalfDuplexConfig
} from '../../src/main/voice/streaming'

function frame(value: number, n = 512): Float32Array {
  return new Float32Array(n).fill(value)
}
const speech = frame(0.1)
const silence = frame(0)

describe('frameRms', () => {
  it('is zero for silence and the constant for a DC frame', () => {
    expect(frameRms(silence)).toBe(0)
    expect(frameRms(frame(0.1))).toBeCloseTo(0.1)
    expect(frameRms(new Float32Array(0))).toBe(0)
  })
})

describe('EnergyVad', () => {
  it('starts an utterance only after minSpeechFrames of speech', () => {
    const vad = new EnergyVad(defaultVadConfig({ minSpeechFrames: 4 }))
    expect(vad.process(speech)).toEqual([])
    expect(vad.process(speech)).toEqual([])
    expect(vad.process(speech)).toEqual([])
    expect(vad.process(speech)).toEqual(['utteranceStart'])
    expect(vad.inUtterance).toBe(true)
  })

  it('debounces spurious noise below the speech-frame floor', () => {
    const vad = new EnergyVad(defaultVadConfig({ minSpeechFrames: 4 }))
    vad.process(speech)
    vad.process(speech)
    vad.process(silence)
    for (let i = 0; i < 3; i++) vad.process(speech)
    expect(vad.inUtterance).toBe(false)
    expect(vad.process(speech)).toEqual(['utteranceStart'])
  })

  it('ends the utterance only after hangoverFrames of silence', () => {
    const vad = new EnergyVad(defaultVadConfig({ minSpeechFrames: 1, hangoverFrames: 5 }))
    expect(vad.process(speech)).toEqual(['utteranceStart'])
    for (let i = 0; i < 4; i++) expect(vad.process(silence)).toEqual([])
    expect(vad.process(silence)).toEqual(['utteranceEnd'])
    expect(vad.inUtterance).toBe(false)
  })

  it('does not cut off on a mid-utterance thinking pause', () => {
    const vad = new EnergyVad(defaultVadConfig({ minSpeechFrames: 1, hangoverFrames: 5 }))
    vad.process(speech)
    for (let i = 0; i < 4; i++) vad.process(silence)
    expect(vad.process(speech)).toEqual([])
    expect(vad.inUtterance).toBe(true)
    for (let i = 0; i < 4; i++) expect(vad.process(silence)).toEqual([])
    expect(vad.process(silence)).toEqual(['utteranceEnd'])
  })

  it('reset returns to idle', () => {
    const vad = new EnergyVad(defaultVadConfig({ minSpeechFrames: 1 }))
    vad.process(speech)
    vad.reset()
    expect(vad.inUtterance).toBe(false)
  })
})

describe('LocalAgreement', () => {
  it('commits a prefix once two hypotheses agree on it', () => {
    const la = new LocalAgreement()
    expect(la.update('the quick')).toEqual({ text: 'the quick', stableUpTo: 0 })
    expect(la.update('the quick brown')).toEqual({ text: 'the quick brown', stableUpTo: 'the quick'.length })
  })

  it('never commits a divergent tail and keeps the frozen prefix stable', () => {
    const la = new LocalAgreement()
    la.update('i think the')
    const p = la.update('i think that')
    expect(p.text).toBe('i think that')
    expect(p.stableUpTo).toBe('i think'.length)
  })

  it('holds the committed prefix even when a later hypothesis revises inside it', () => {
    const la = new LocalAgreement()
    la.update('i think that')
    la.update('i think that answer')
    const p = la.update('i think this')
    expect(p.text.startsWith('i think that')).toBe(true)
    expect(p.stableUpTo).toBe('i think that'.length)
  })

  it('ignores trailing punctuation and casing when agreeing', () => {
    const la = new LocalAgreement()
    la.update('So, I built')
    const p = la.update('so I built a service')
    expect(p.text).toBe('so I built a service')
    expect(p.stableUpTo).toBe('so I built'.length)
  })

  it('finalize commits the whole hypothesis', () => {
    const la = new LocalAgreement()
    la.update('almost done')
    const p = la.finalize('almost done now')
    expect(p).toEqual({ text: 'almost done now', stableUpTo: 'almost done now'.length })
  })

  it('finalize with no arg commits the last hypothesis', () => {
    const la = new LocalAgreement()
    la.update('last words here')
    const p = la.finalize()
    expect(p.stableUpTo).toBe('last words here'.length)
  })
})

describe('StreamWindow', () => {
  it('signals a decode only after a full interval of fresh audio', () => {
    const w = new StreamWindow(defaultWindowConfig({ decodeIntervalSamples: 1000 }))
    w.append(frame(0.1, 600))
    expect(w.shouldDecode()).toBe(false)
    w.append(frame(0.1, 600))
    expect(w.shouldDecode()).toBe(true)
    w.markDecoded()
    expect(w.shouldDecode()).toBe(false)
  })

  it('concatenates buffered frames into the window', () => {
    const w = new StreamWindow()
    w.append(Float32Array.of(1, 2))
    w.append(Float32Array.of(3, 4, 5))
    expect(Array.from(w.window())).toEqual([1, 2, 3, 4, 5])
  })

  it('drops oldest audio past the window cap', () => {
    const w = new StreamWindow(defaultWindowConfig({ maxWindowSamples: 4 }))
    w.append(frame(0.1, 2))
    w.append(frame(0.2, 2))
    w.append(frame(0.3, 2))
    expect(w.window().length).toBe(4)
  })

  it('reports window duration in ms', () => {
    const w = new StreamWindow(defaultWindowConfig({ sampleRate: 16000 }))
    w.append(frame(0.1, 16000))
    expect(w.windowMs).toBe(1000)
  })
})

describe('RtfMeter', () => {
  it('tracks mean and worst real-time factor', () => {
    const m = new RtfMeter()
    m.record(1000, 400)
    m.record(1000, 800)
    expect(m.meanRtf).toBeCloseTo(0.6)
    expect(m.worstRtf).toBeCloseTo(0.8)
    expect(m.realTime).toBe(true)
  })

  it('flags non-real-time when a decode exceeds its audio', () => {
    const m = new RtfMeter()
    m.record(1000, 1200)
    expect(m.realTime).toBe(false)
  })

  it('is empty-safe', () => {
    const m = new RtfMeter()
    expect(m.meanRtf).toBe(0)
    expect(m.worstRtf).toBe(0)
  })
})

describe('HalfDuplexGate', () => {
  it('closes capture while TTS speaks and through the echo guard tail', () => {
    const gate = new HalfDuplexGate(defaultHalfDuplexConfig({ guardMs: 250 }))
    expect(gate.captureOpen(0)).toBe(true)
    gate.onTtsStart()
    expect(gate.captureOpen(100)).toBe(false)
    gate.onTtsEnd(1000)
    expect(gate.captureOpen(1100)).toBe(false)
    expect(gate.captureOpen(1250)).toBe(true)
  })

  it('reset reopens capture', () => {
    const gate = new HalfDuplexGate()
    gate.onTtsStart()
    gate.reset()
    expect(gate.captureOpen(0)).toBe(true)
  })
})
