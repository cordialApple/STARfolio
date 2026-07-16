import { describe, expect, it } from 'vitest'
import { StreamDecoder, defaultWindowConfig } from '../../src/main/voice/streaming'
import type { TranscriptEvent, VadEvent } from '../../src/main/voice/streaming'

const FRAME = 512
const FRAMES_PER_DECODE = 32

function speech(n = FRAME): Float32Array {
  return new Float32Array(n).fill(0.1)
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function start(dec: StreamDecoder): void {
  dec.onFrame(speech(), ['utteranceStart'])
}

function end(dec: StreamDecoder): void {
  dec.onFrame(speech(), ['utteranceEnd'])
}

function feed(dec: StreamDecoder, count: number, events: VadEvent[] = []): void {
  for (let i = 0; i < count; i++) dec.onFrame(speech(), events)
}

describe('StreamDecoder', () => {
  it('utteranceStart begins a turn and emits a non-final partial once the window says decode', async () => {
    const emits: TranscriptEvent[] = []
    const dec = new StreamDecoder(async () => 'hello world', (e) => emits.push(e))

    expect(dec.inTurn).toBe(false)
    start(dec)
    expect(dec.inTurn).toBe(true)

    feed(dec, FRAMES_PER_DECODE - 2)
    await dec.drain()
    expect(emits).toEqual([])

    feed(dec, 1)
    await dec.drain()

    expect(emits).toHaveLength(1)
    expect(emits[0]).toEqual({ text: 'hello world', stableUpTo: 0, isFinal: false })
  })

  it('utteranceEnd finalizes: emits isFinal and leaves the turn', async () => {
    const emits: TranscriptEvent[] = []
    const dec = new StreamDecoder(async () => 'hello world', (e) => emits.push(e))

    start(dec)
    feed(dec, FRAMES_PER_DECODE)
    end(dec)
    await dec.drain()

    expect(dec.inTurn).toBe(false)
    const finals = emits.filter((e) => e.isFinal)
    expect(finals).toHaveLength(1)
    expect(finals[0]).toEqual({ text: 'hello world', stableUpTo: 'hello world'.length, isFinal: true })
  })

  it('single-flight: a slow decode blocks concurrent decodes; the next uses the grown window', async () => {
    let calls = 0
    const lens: number[] = []
    const gates: Array<{ promise: Promise<string>; resolve: (v: string) => void }> = []
    const decode = (audio: Float32Array): Promise<string> => {
      calls++
      lens.push(audio.length)
      const d = deferred<string>()
      gates.push(d)
      return d.promise
    }
    const emits: TranscriptEvent[] = []
    const dec = new StreamDecoder(decode, (e) => emits.push(e))

    start(dec)
    feed(dec, FRAMES_PER_DECODE - 1)
    await tick()
    expect(calls).toBe(1)

    feed(dec, FRAMES_PER_DECODE)
    await tick()
    expect(calls).toBe(1)

    gates[0].resolve('hello world')
    await tick()

    feed(dec, 1)
    await tick()
    expect(calls).toBe(2)
    expect(lens[1]).toBeGreaterThan(lens[0])

    gates[1].resolve('hello world')
    await dec.drain()
    expect(emits.filter((e) => !e.isFinal)).toHaveLength(2)
  })

  it('LocalAgreement stabilization: stableUpTo is monotonic non-decreasing across partials', async () => {
    const responses = ['the quick', 'the quick brown', 'the quick brown fox']
    let i = 0
    const decode = async (): Promise<string> => responses[Math.min(i++, responses.length - 1)]
    const emits: TranscriptEvent[] = []
    const dec = new StreamDecoder(decode, (e) => emits.push(e))

    start(dec)
    feed(dec, FRAMES_PER_DECODE - 1)
    await dec.drain()
    feed(dec, FRAMES_PER_DECODE)
    await dec.drain()
    feed(dec, FRAMES_PER_DECODE)
    await dec.drain()

    const stable = emits.filter((e) => !e.isFinal).map((e) => e.stableUpTo)
    expect(stable).toHaveLength(3)
    for (let k = 1; k < stable.length; k++) expect(stable[k]).toBeGreaterThanOrEqual(stable[k - 1])
    expect(stable[stable.length - 1]).toBeGreaterThan(0)
  })

  it('cross-turn isolation: turn B partials carry none of turn A committed text', async () => {
    let text = 'alpha beta'
    const decode = async (): Promise<string> => text
    const emits: TranscriptEvent[] = []
    const dec = new StreamDecoder(decode, (e) => emits.push(e))

    start(dec)
    feed(dec, FRAMES_PER_DECODE - 1)
    await dec.drain()
    end(dec)
    await dec.drain()

    emits.length = 0
    text = 'gamma delta'
    start(dec)
    feed(dec, FRAMES_PER_DECODE - 1)
    await dec.drain()

    const partialB = emits.filter((e) => !e.isFinal)
    expect(partialB).toHaveLength(1)
    expect(partialB[0].text).toBe('gamma delta')
    expect(partialB[0].text).not.toMatch(/alpha|beta/)
    expect(partialB[0].stableUpTo).toBe(0)
  })

  it('a rejecting decode does not break the chain: later partials and the final still emit', async () => {
    let n = 0
    const decode = async (): Promise<string> => {
      n++
      if (n === 1) throw new Error('boom')
      return 'recovered'
    }
    const emits: TranscriptEvent[] = []
    const dec = new StreamDecoder(decode, (e) => emits.push(e))

    start(dec)
    feed(dec, FRAMES_PER_DECODE - 1)
    await dec.drain()
    expect(emits).toEqual([])

    feed(dec, FRAMES_PER_DECODE)
    await dec.drain()
    end(dec)
    await dec.drain()

    expect(emits.filter((e) => !e.isFinal).map((e) => e.text)).toContain('recovered')
    const finals = emits.filter((e) => e.isFinal)
    expect(finals).toHaveLength(1)
    expect(finals[0].text).toBe('recovered')
    expect(dec.inTurn).toBe(false)
  })

  it('reset clears turn + busy + chain so a fresh turn decodes clean', async () => {
    let calls = 0
    const stuck = deferred<string>()
    const decode = (): Promise<string> => {
      calls++
      return calls === 1 ? stuck.promise : Promise.resolve('clean text')
    }
    const emits: TranscriptEvent[] = []
    const dec = new StreamDecoder(decode, (e) => emits.push(e))

    start(dec)
    feed(dec, FRAMES_PER_DECODE - 1)
    await tick()
    expect(calls).toBe(1)

    dec.reset()
    expect(dec.inTurn).toBe(false)
    emits.length = 0

    start(dec)
    feed(dec, FRAMES_PER_DECODE - 1)
    await dec.drain()

    expect(calls).toBe(2)
    expect(emits.filter((e) => !e.isFinal)).toEqual([{ text: 'clean text', stableUpTo: 0, isFinal: false }])
  })

  it('empty-window final emits an isFinal event without calling decode on non-empty audio', async () => {
    let calls = 0
    const decode = async (audio: Float32Array): Promise<string> => {
      calls++
      return audio.length ? 'nope' : ''
    }
    const emits: TranscriptEvent[] = []
    const dec = new StreamDecoder(decode, (e) => emits.push(e), defaultWindowConfig())

    dec.onFrame(new Float32Array(0), ['utteranceStart'])
    dec.onFrame(new Float32Array(0), ['utteranceEnd'])
    await dec.drain()

    expect(calls).toBe(0)
    expect(dec.inTurn).toBe(false)
    expect(emits).toEqual([{ text: '', stableUpTo: 0, isFinal: true }])
  })
})
