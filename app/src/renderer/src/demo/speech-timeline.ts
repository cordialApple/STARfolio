export interface SpeechDetectorOptions {
  sampleRate: number
  windowSamples: number
  thresholdRms: number
  hangoverMs: number
}

export interface SpeechBoundary {
  type: 'speech-start' | 'speech-end'
  sampleOffset: number
  estimatedAtMs: number
  latestObservedAtMs: number
  quantizationMs: number
  uncertaintyMs: null
  partial?: true
}

export interface SpeechSegmentDetector {
  push: (samples: Float32Array, startSample: number, observedAtMs: number) => SpeechBoundary[]
  finish: (observedAtMs: number) => SpeechBoundary[]
}

export function createSpeechSegmentDetector(options: SpeechDetectorOptions): SpeechSegmentDetector {
  const { sampleRate, windowSamples, thresholdRms, hangoverMs } = options
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Invalid sampleRate')
  if (!Number.isInteger(windowSamples) || windowSamples <= 0)
    throw new RangeError('Invalid windowSamples')
  if (!Number.isFinite(thresholdRms) || thresholdRms <= 0 || thresholdRms > 1)
    throw new RangeError('Invalid thresholdRms')
  if (!Number.isFinite(hangoverMs) || hangoverMs < 0)
    throw new RangeError('Invalid hangoverMs')

  const hangoverSamples = (hangoverMs / 1000) * sampleRate
  const quantizationMs = (windowSamples / sampleRate) * 1000
  let nextSample: number | undefined
  let windowStart = 0
  let windowCount = 0
  let squareSum = 0
  let speaking = false
  let lastVoicedEnd = 0
  let lastObservedAtMs: number | undefined

  function boundary(
    type: SpeechBoundary['type'],
    sampleOffset: number,
    observedAtMs: number,
    partial?: true
  ): SpeechBoundary {
    return {
      type,
      sampleOffset,
      estimatedAtMs: observedAtMs - ((nextSample! - sampleOffset) / sampleRate) * 1000,
      latestObservedAtMs: observedAtMs,
      quantizationMs,
      uncertaintyMs: null,
      ...(partial ? { partial } : {})
    }
  }

  function inspectWindow(observedAtMs: number, events: SpeechBoundary[]): void {
    const end = windowStart + windowCount
    const voiced = Math.sqrt(squareSum / windowCount) >= thresholdRms
    if (voiced) {
      if (!speaking) {
        speaking = true
        events.push(boundary('speech-start', windowStart, observedAtMs))
      }
      lastVoicedEnd = end
    } else if (speaking && end - lastVoicedEnd >= hangoverSamples) {
      speaking = false
      events.push(boundary('speech-end', lastVoicedEnd, observedAtMs))
    }
    windowCount = 0
    squareSum = 0
  }

  return {
    push(samples, startSample, observedAtMs): SpeechBoundary[] {
      if (!Number.isInteger(startSample) || startSample < 0 || nextSample !== undefined && startSample !== nextSample)
        throw new RangeError('Noncontiguous sample offset')
      if (!Number.isFinite(observedAtMs)) throw new RangeError('Invalid observedAtMs')
      nextSample = startSample + samples.length
      lastObservedAtMs = observedAtMs
      const events: SpeechBoundary[] = []
      for (let i = 0; i < samples.length; i++) {
        if (windowCount === 0) windowStart = startSample + i
        squareSum += samples[i] * samples[i]
        windowCount++
        if (windowCount === windowSamples) inspectWindow(observedAtMs, events)
      }
      return events
    },
    finish(observedAtMs): SpeechBoundary[] {
      if (!Number.isFinite(observedAtMs)) throw new RangeError('Invalid observedAtMs')
      const events: SpeechBoundary[] = []
      const frameObservedAtMs = lastObservedAtMs ?? observedAtMs
      if (windowCount > 0) inspectWindow(frameObservedAtMs, events)
      if (speaking) {
        events.push(boundary('speech-end', lastVoicedEnd, frameObservedAtMs, true))
        speaking = false
      }
      return events
    }
  }
}
