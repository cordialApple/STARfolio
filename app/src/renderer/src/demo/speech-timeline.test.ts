import { describe, expect, it } from 'vitest'
import { createSpeechSegmentDetector } from './speech-timeline'

describe('speech segment detector', () => {
  const options = { sampleRate: 24000, windowSamples: 240, thresholdRms: 0.1, hangoverMs: 20 }

  it('ignores silent PCM before first voiced window', () => {
    const detector = createSpeechSegmentDetector(options)
    const samples = new Float32Array(1200)
    samples.fill(0.4, 480, 720)
    expect(detector.push(samples, 0, 1010)).toEqual([
      expect.objectContaining({ type: 'speech-start', sampleOffset: 480, estimatedAtMs: 980 }),
      expect.objectContaining({ type: 'speech-end', sampleOffset: 720, estimatedAtMs: 990 })
    ])
  })

  it('keeps speech open across chunks and closes at last voiced sample', () => {
    const detector = createSpeechSegmentDetector(options)
    expect(detector.push(new Float32Array(240).fill(0.4), 0, 10)).toEqual([
      expect.objectContaining({ type: 'speech-start', sampleOffset: 0 })
    ])
    expect(detector.push(new Float32Array(240), 240, 20)).toEqual([])
    expect(detector.push(new Float32Array(240), 480, 30)).toEqual([
      expect.objectContaining({ type: 'speech-end', sampleOffset: 240 })
    ])
  })

  it('flushes unfinished speech as partial on finish', () => {
    const detector = createSpeechSegmentDetector(options)
    detector.push(new Float32Array(240).fill(0.4), 0, 10)
    expect(detector.finish(10)).toEqual([
      expect.objectContaining({ type: 'speech-end', sampleOffset: 240, partial: true })
    ])
  })

  it('anchors a delayed finish to last PCM receipt', () => {
    const detector = createSpeechSegmentDetector(options)
    detector.push(new Float32Array(240).fill(0.4), 0, 10)
    expect(detector.finish(1000)).toEqual([
      expect.objectContaining({
        type: 'speech-end',
        sampleOffset: 240,
        estimatedAtMs: 10,
        latestObservedAtMs: 10,
        partial: true
      })
    ])
  })

  it('leaves unanswered silence without an invented segment', () => {
    const detector = createSpeechSegmentDetector(options)
    expect(detector.push(new Float32Array(240), 0, 10)).toEqual([])
    expect(detector.finish(10)).toEqual([])
  })

  it('preserves renderer clock uncertainty as unknown', () => {
    const detector = createSpeechSegmentDetector(options)
    expect(detector.push(new Float32Array(240).fill(0.4), 0, 10)[0]).toEqual(
      expect.objectContaining({ uncertaintyMs: null, quantizationMs: 10, latestObservedAtMs: 10 })
    )
  })
})
