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

describe('frameRms edges', () => {
  it('is magnitude-based for negative and mixed-sign frames', () => {
    expect(frameRms(frame(-0.1))).toBeCloseTo(0.1)
    expect(frameRms(Float32Array.of(0.2, -0.2))).toBeCloseTo(0.2)
  })

  it('handles a single-sample frame', () => {
    expect(frameRms(Float32Array.of(0.5))).toBeCloseTo(0.5)
  })

  it('underflows subnormal magnitudes to zero', () => {
    expect(frameRms(frame(Number.MIN_VALUE, 4))).toBe(0)
  })
})

describe('EnergyVad edges', () => {
  it('treats RMS exactly at the threshold as speech (>= boundary)', () => {
    const vad = new EnergyVad(defaultVadConfig({ minSpeechFrames: 1, energyThreshold: 0.0125 }))
    expect(vad.process(frame(0.0125))).toEqual(['utteranceStart'])
  })

  it('treats RMS just below the threshold as silence', () => {
    const vad = new EnergyVad(defaultVadConfig({ minSpeechFrames: 1, energyThreshold: 0.0125 }))
    expect(vad.process(frame(0.0124))).toEqual([])
    expect(vad.inUtterance).toBe(false)
  })

  it('handles back-to-back utterances on one instance', () => {
    const vad = new EnergyVad(defaultVadConfig({ minSpeechFrames: 1, hangoverFrames: 2 }))
    expect(vad.process(speech)).toEqual(['utteranceStart'])
    expect(vad.process(silence)).toEqual([])
    expect(vad.process(silence)).toEqual(['utteranceEnd'])
    expect(vad.process(speech)).toEqual(['utteranceStart'])
    expect(vad.inUtterance).toBe(true)
  })

  it('resumes cleanly after reset mid-utterance', () => {
    const vad = new EnergyVad(defaultVadConfig({ minSpeechFrames: 1, hangoverFrames: 3 }))
    vad.process(speech)
    vad.process(silence)
    vad.reset()
    expect(vad.inUtterance).toBe(false)
    expect(vad.process(speech)).toEqual(['utteranceStart'])
    expect(vad.inUtterance).toBe(true)
  })

  it('resets the silence run each time speech interrupts the hangover', () => {
    const vad = new EnergyVad(defaultVadConfig({ minSpeechFrames: 1, hangoverFrames: 3 }))
    vad.process(speech)
    expect(vad.process(silence)).toEqual([])
    expect(vad.process(silence)).toEqual([])
    expect(vad.process(speech)).toEqual([])
    expect(vad.process(silence)).toEqual([])
    expect(vad.process(silence)).toEqual([])
    expect(vad.process(silence)).toEqual(['utteranceEnd'])
  })
})

describe('LocalAgreement edges', () => {
  it('is a no-op for empty and whitespace-only hypotheses', () => {
    const la = new LocalAgreement()
    expect(la.update('')).toEqual({ text: '', stableUpTo: 0 })
    expect(la.update('   ')).toEqual({ text: '', stableUpTo: 0 })
  })

  it('commits a repeated single-word hypothesis on the second tick', () => {
    const la = new LocalAgreement()
    expect(la.update('hello')).toEqual({ text: 'hello', stableUpTo: 0 })
    expect(la.update('hello')).toEqual({ text: 'hello', stableUpTo: 'hello'.length })
  })

  it('commits the agreed prefix when a hypothesis shrinks', () => {
    const la = new LocalAgreement()
    la.update('one two three')
    expect(la.update('one two')).toEqual({ text: 'one two', stableUpTo: 'one two'.length })
  })

  it('never regresses a committed prefix when a later hypothesis shrinks inside it', () => {
    const la = new LocalAgreement()
    la.update('a b c')
    la.update('a b c')
    const p = la.update('a b')
    expect(p.text).toBe('a b c')
    expect(p.stableUpTo).toBe('a b c'.length)
  })

  it('wipes state when finalizing an empty hypothesis', () => {
    const la = new LocalAgreement()
    la.update('done')
    la.update('done')
    expect(la.finalize('')).toEqual({ text: '', stableUpTo: 0 })
  })

  it('commits punctuation-only tokens verbatim once repeated', () => {
    const la = new LocalAgreement()
    expect(la.update('...')).toEqual({ text: '...', stableUpTo: 0 })
    expect(la.update('...')).toEqual({ text: '...', stableUpTo: '...'.length })
  })

  it('keeps stableUpTo within the reported text length', () => {
    const la = new LocalAgreement()
    la.update('keep growing here')
    const p = la.update('keep growing here now')
    expect(p.stableUpTo).toBeLessThanOrEqual(p.text.length)
    expect(p.stableUpTo).toBe('keep growing here'.length)
  })

  it('reset clears committed and previous state', () => {
    const la = new LocalAgreement()
    la.update('one two')
    la.update('one two')
    la.reset()
    expect(la.update('three four')).toEqual({ text: 'three four', stableUpTo: 0 })
  })
})

describe('StreamWindow edges', () => {
  it('does not signal a decode before any audio arrives', () => {
    const w = new StreamWindow()
    expect(w.shouldDecode()).toBe(false)
  })

  it('tolerates markDecoded with no prior append', () => {
    const w = new StreamWindow()
    w.markDecoded()
    expect(w.shouldDecode()).toBe(false)
  })

  it('returns an empty window on an empty buffer', () => {
    const w = new StreamWindow()
    expect(w.window().length).toBe(0)
    expect(w.windowMs).toBe(0)
  })

  it('signals a decode at the exact interval boundary', () => {
    const w = new StreamWindow(defaultWindowConfig({ decodeIntervalSamples: 1000 }))
    w.append(frame(0.1, 1000))
    expect(w.shouldDecode()).toBe(true)
  })

  it('ignores a zero-length frame', () => {
    const w = new StreamWindow(defaultWindowConfig({ decodeIntervalSamples: 4 }))
    w.append(new Float32Array(0))
    expect(w.window().length).toBe(0)
    expect(w.shouldDecode()).toBe(false)
    w.append(frame(0.1, 4))
    expect(w.window().length).toBe(4)
    expect(w.shouldDecode()).toBe(true)
  })

  it('reports duration off the trimmed total after a cap drop', () => {
    const w = new StreamWindow(defaultWindowConfig({ sampleRate: 1000, maxWindowSamples: 4 }))
    w.append(frame(0.1, 2))
    w.append(frame(0.2, 2))
    w.append(frame(0.3, 2))
    expect(w.window().length).toBe(4)
    expect(w.windowMs).toBe(4)
  })
})

describe('RtfMeter edges', () => {
  it('reports the factor from a single record', () => {
    const m = new RtfMeter()
    m.record(1000, 400)
    expect(m.meanRtf).toBeCloseTo(0.4)
    expect(m.worstRtf).toBeCloseTo(0.4)
    expect(m.realTime).toBe(true)
  })

  it('guards against a zero-audio window without producing NaN', () => {
    const m = new RtfMeter()
    m.record(0, 500)
    expect(m.meanRtf).toBe(0)
    expect(m.worstRtf).toBe(0)
    expect(m.realTime).toBe(true)
  })

  it('treats rtf exactly 1.0 as not real-time', () => {
    const m = new RtfMeter()
    m.record(1000, 1000)
    expect(m.worstRtf).toBeCloseTo(1)
    expect(m.realTime).toBe(false)
  })

  it('keeps worst at least the mean', () => {
    const m = new RtfMeter()
    m.record(1000, 300)
    m.record(1000, 900)
    expect(m.worstRtf).toBeGreaterThanOrEqual(m.meanRtf)
  })

  it('reset clears accumulated state', () => {
    const m = new RtfMeter()
    m.record(1000, 1200)
    m.reset()
    expect(m.meanRtf).toBe(0)
    expect(m.worstRtf).toBe(0)
    expect(m.realTime).toBe(true)
  })
})

describe('HalfDuplexGate edges', () => {
  it('reopens capture exactly at releaseAt (>= boundary)', () => {
    const gate = new HalfDuplexGate(defaultHalfDuplexConfig({ guardMs: 250 }))
    gate.onTtsEnd(1000)
    expect(gate.captureOpen(999)).toBe(false)
    expect(gate.captureOpen(1250)).toBe(true)
  })

  it('imposes the guard even without a prior onTtsStart', () => {
    const gate = new HalfDuplexGate(defaultHalfDuplexConfig({ guardMs: 250 }))
    gate.onTtsEnd(1000)
    expect(gate.captureOpen(1100)).toBe(false)
    expect(gate.captureOpen(1250)).toBe(true)
  })

  it('needs one onTtsEnd to clear a doubled onTtsStart', () => {
    const gate = new HalfDuplexGate(defaultHalfDuplexConfig({ guardMs: 0 }))
    gate.onTtsStart()
    gate.onTtsStart()
    expect(gate.captureOpen(500)).toBe(false)
    gate.onTtsEnd(500)
    expect(gate.captureOpen(500)).toBe(true)
  })

  it('lets a later onTtsEnd with an earlier timestamp shorten the guard', () => {
    const gate = new HalfDuplexGate(defaultHalfDuplexConfig({ guardMs: 250 }))
    gate.onTtsEnd(1000)
    gate.onTtsEnd(500)
    expect(gate.captureOpen(760)).toBe(true)
  })
})
