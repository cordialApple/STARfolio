import type { MoshiTimingEvent } from '../../../preload/index.d'
import type { RecordingFrameTiming } from '../audio/recorder'
import { createSpeechSegmentDetector, type SpeechBoundary } from './speech-timeline'

interface LatencySessionOptions {
  emit: (event: MoshiTimingEvent) => void
  now: () => number
  timeOriginUtcMs: number
  sampleRate?: number
}

interface OutputTiming {
  receivedAtMs: number
  scheduledStartMs: number
  clockSource?: 'audio-output-timestamp' | 'renderer-fallback' | null
}

interface OutputChunk extends OutputTiming {
  startSample: number
  endSample: number
}

export interface LatencySession {
  micReady: () => void
  input: (samples: Float32Array, timing: RecordingFrameTiming) => void
  output: (samples: Float32Array, timing: OutputTiming) => void
  finish: () => void
}

export function createLatencySession({
  emit,
  now,
  timeOriginUtcMs,
  sampleRate = 24000
}: LatencySessionOptions): LatencySession {
  const windowSamples = Math.round(sampleRate / 100)
  const hangoverMs = 120
  const detectorOptions = { sampleRate, windowSamples, thresholdRms: 0.08, hangoverMs }
  const candidate = createSpeechSegmentDetector(detectorOptions)
  const assistant = createSpeechSegmentDetector(detectorOptions)
  const outputChunks: OutputChunk[] = []
  let sequence = 0
  let segmentId = 0
  let candidateSegmentId: number | null = null
  let assistantSegmentId: number | null = null
  let candidateSpoke = false
  let assistantVoiced = false
  let outputNextSample = 0
  let ended = false

  function publish(
    kind: MoshiTimingEvent['kind'],
    values: Partial<Omit<MoshiTimingEvent, 'schemaVersion' | 'sequence' | 'kind' | 'rendererTimeOriginUtcMs'>> = {}
  ): void {
    emit({
      schemaVersion: 1,
      sequence: ++sequence,
      kind,
      rendererTimeMs: now(),
      rendererTimeOriginUtcMs: timeOriginUtcMs,
      sampleOffset: null,
      estimatedAtMs: null,
      observedAtMs: null,
      quantizationMs: null,
      uncertaintyMs: null,
      ...values
    })
  }

  function chunkFor(sampleOffset: number): OutputChunk {
    const chunk = outputChunks.find(
      (item) => sampleOffset >= item.startSample && sampleOffset < item.endSample
    )
    if (chunk) return chunk
    const last = outputChunks.at(-1)
    if (last && sampleOffset === last.endSample) return last
    throw new RangeError('Missing output schedule for speech boundary')
  }

  function boundaryStatus(
    boundary: SpeechBoundary,
    overlappingSegmentId: number | null
  ): 'cancelled' | 'ambiguous' | 'observed' {
    if (boundary.partial) return 'cancelled'
    if (overlappingSegmentId !== null) return 'ambiguous'
    return 'observed'
  }

  function candidateBoundary(boundary: SpeechBoundary): void {
    if (boundary.type === 'speech-start') {
      candidateSpoke = true
      candidateSegmentId = ++segmentId
    }
    publish(boundary.type === 'speech-start' ? 'candidate-speech-start' : 'candidate-speech-end', {
      sampleOffset: boundary.sampleOffset,
      estimatedAtMs: boundary.estimatedAtMs,
      observedAtMs: boundary.latestObservedAtMs,
      quantizationMs: boundary.quantizationMs,
      uncertaintyMs: boundary.uncertaintyMs,
      segmentId: candidateSegmentId,
      status: boundaryStatus(boundary, assistantSegmentId)
    })
    if (boundary.type === 'speech-end') candidateSegmentId = null
  }

  function assistantBoundary(boundary: SpeechBoundary): void {
    const chunk = chunkFor(boundary.sampleOffset)
    const scheduledAtMs =
      chunk.scheduledStartMs + ((boundary.sampleOffset - chunk.startSample) / sampleRate) * 1000
    if (boundary.type === 'speech-start') {
      assistantVoiced = true
      assistantSegmentId = ++segmentId
    }
    let kind: MoshiTimingEvent['kind']
    if (boundary.type === 'speech-start') kind = 'assistant-voice-scheduled'
    else if (boundary.partial) kind = 'assistant-voice-interrupted'
    else kind = 'assistant-voice-end'
    publish(
      kind,
      {
        sampleOffset: boundary.sampleOffset,
        estimatedAtMs: scheduledAtMs,
        observedAtMs: chunk.receivedAtMs,
        quantizationMs: boundary.quantizationMs,
        uncertaintyMs: boundary.uncertaintyMs,
        segmentId: assistantSegmentId,
        queuedMs: Math.max(0, chunk.scheduledStartMs - chunk.receivedAtMs),
        clockSource: chunk.clockSource ?? null,
        status: boundaryStatus(boundary, candidateSegmentId)
      }
    )
    if (boundary.type === 'speech-end') assistantSegmentId = null
  }

  return {
    micReady(): void {
      if (!ended) publish('mic-ready')
    },
    input(samples, timing): void {
      if (ended) return
      if (timing.endSample - timing.startSample !== samples.length)
        throw new RangeError('Input timing sample count mismatch')
      for (const boundary of candidate.push(samples, timing.startSample, timing.observedAtMs))
        candidateBoundary(boundary)
    },
    output(samples, timing): void {
      if (ended) return
      const startSample = outputNextSample
      outputNextSample += samples.length
      if (samples.length === 0) return
      outputChunks.push({ ...timing, startSample, endSample: outputNextSample })
      publish('audio-received', {
        sampleOffset: startSample,
        observedAtMs: timing.receivedAtMs
      })
      for (const boundary of assistant.push(samples, startSample, timing.receivedAtMs))
        assistantBoundary(boundary)
      while (outputChunks.length > 1 && outputChunks[0].endSample < outputNextSample - sampleRate)
        outputChunks.shift()
    },
    finish(): void {
      if (ended) return
      ended = true
      for (const boundary of candidate.finish(now())) candidateBoundary(boundary)
      for (const boundary of assistant.finish(now())) assistantBoundary(boundary)
      publish('session-ended', { status: candidateSpoke && !assistantVoiced ? 'unanswered' : 'observed' })
    }
  }
}
