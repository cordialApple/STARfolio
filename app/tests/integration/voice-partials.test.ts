import { describe, expect, it } from 'vitest'
import { VoiceStreamSession } from '../../src/main/voice/streaming'
import type {
  StreamSessionEvent,
  TranscriptEvent,
  DecodeFn
} from '../../src/main/voice/streaming'

function speech(n: number): Float32Array {
  return new Float32Array(n).fill(0.1)
}
function silence(n: number): Float32Array {
  return new Float32Array(n).fill(0)
}

const FRAME = 512

async function flushUntil(pred: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return
    await new Promise((r) => setImmediate(r))
  }
}

function makeDecode() {
  const audioLengths: number[] = []
  let turnText = ''
  const decode: DecodeFn = async (samples) => {
    audioLengths.push(samples.length)
    return turnText
  }
  return {
    decode,
    audioLengths,
    setTurnText(text: string) {
      turnText = text
    }
  }
}

function assertMonotonicStable(events: TranscriptEvent[]): void {
  let last = -1
  for (const e of events) {
    expect(e.stableUpTo).toBeGreaterThanOrEqual(last)
    last = e.stableUpTo
  }
}

describe('streaming ASR partials (frame -> VAD -> StreamDecoder)', () => {
  it('drives at least one partial then a final across a full turn', async () => {
    const vad: StreamSessionEvent[] = []
    const transcripts: TranscriptEvent[] = []
    const d = makeDecode()
    d.setTurnText('hello there friend')
    const session = new VoiceStreamSession((e) => vad.push(e), undefined, {
      decode: d.decode,
      onTranscript: (t) => transcripts.push(t)
    })

    session.pushFrames(silence(FRAME * 2))
    session.pushFrames(speech(FRAME * 40))
    session.pushFrames(silence(FRAME * 45))

    await flushUntil(() => transcripts.some((t) => t.isFinal))

    expect(vad.map((e) => e.kind)).toEqual(['utteranceStart', 'utteranceEnd'])
    expect(transcripts.length).toBeGreaterThanOrEqual(1)
    expect(transcripts.some((t) => !t.isFinal)).toBe(true)
    expect(transcripts[transcripts.length - 1].isFinal).toBe(true)
    assertMonotonicStable(transcripts)

    expect(d.audioLengths.length).toBeGreaterThan(0)
    expect(d.audioLengths.every((n) => n > 0)).toBe(true)

    session.close()
  })

  it('a session without decode/onTranscript emits VAD but no transcripts (6b.2 back-compat)', async () => {
    const vad: StreamSessionEvent[] = []
    const transcripts: TranscriptEvent[] = []
    const session = new VoiceStreamSession((e) => vad.push(e))

    session.pushFrames(speech(FRAME * 6))
    session.pushFrames(silence(FRAME * 45))
    await flushUntil(() => false, 5)

    expect(vad.map((e) => e.kind)).toEqual(['utteranceStart', 'utteranceEnd'])
    expect(transcripts).toEqual([])

    session.close()
  })

  it('after close, further frames emit neither VAD nor partials', async () => {
    const vad: StreamSessionEvent[] = []
    const transcripts: TranscriptEvent[] = []
    const d = makeDecode()
    d.setTurnText('ignored')
    const session = new VoiceStreamSession((e) => vad.push(e), undefined, {
      decode: d.decode,
      onTranscript: (t) => transcripts.push(t)
    })

    session.close()
    session.pushFrames(speech(FRAME * 40))
    session.pushFrames(silence(FRAME * 45))
    await flushUntil(() => false, 5)

    expect(vad).toEqual([])
    expect(transcripts).toEqual([])
    expect(d.audioLengths).toEqual([])
  })

  it('two sequential turns each produce their own final without inheriting committed text', async () => {
    const vad: StreamSessionEvent[] = []
    const transcripts: TranscriptEvent[] = []
    const d = makeDecode()
    const session = new VoiceStreamSession((e) => vad.push(e), undefined, {
      decode: d.decode,
      onTranscript: (t) => transcripts.push(t)
    })

    d.setTurnText('alpha beta gamma')
    session.pushFrames(silence(FRAME * 2))
    session.pushFrames(speech(FRAME * 40))
    session.pushFrames(silence(FRAME * 45))
    await flushUntil(() => transcripts.some((t) => t.isFinal))
    const afterFirst = transcripts.length

    d.setTurnText('delta epsilon zeta')
    session.pushFrames(speech(FRAME * 40))
    session.pushFrames(silence(FRAME * 45))
    await flushUntil(() => transcripts.filter((t) => t.isFinal).length >= 2)

    const finals = transcripts.filter((t) => t.isFinal)
    expect(finals.length).toBe(2)
    expect(finals[0].text).toBe('alpha beta gamma')
    expect(finals[1].text).toBe('delta epsilon zeta')
    expect(finals[1].text).not.toContain('alpha')

    const secondTurn = transcripts.slice(afterFirst)
    expect(secondTurn.every((t) => !t.text.includes('alpha'))).toBe(true)

    expect(vad.map((e) => e.kind)).toEqual([
      'utteranceStart',
      'utteranceEnd',
      'utteranceStart',
      'utteranceEnd'
    ])

    session.close()
  })
})
