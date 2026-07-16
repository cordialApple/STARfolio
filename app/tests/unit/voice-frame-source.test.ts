import { describe, expect, it } from 'vitest'
import {
  SampleRingBuffer,
  defaultRingBufferConfig,
  FrameSource,
  defaultFrameSourceConfig,
  defaultRingBufferConfig as ringCfg,
  defaultVadConfig,
  SAMPLE_RATE
} from '../../src/main/voice/streaming'

function ramp(n: number, from = 0): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = from + i
  return out
}
function fill(n: number, value: number): Float32Array {
  return new Float32Array(n).fill(value)
}
const speechFrame = (n = 512) => fill(n, 0.1)
const silenceFrame = (n = 512) => fill(n, 0)

describe('defaultRingBufferConfig', () => {
  it('defaults capacitySamples to SAMPLE_RATE * 10', () => {
    expect(defaultRingBufferConfig().capacitySamples).toBe(SAMPLE_RATE * 10)
    expect(SAMPLE_RATE * 10).toBe(160000)
  })
  it('merges overrides', () => {
    expect(defaultRingBufferConfig({ capacitySamples: 42 })).toEqual({ capacitySamples: 42 })
  })
})

describe('SampleRingBuffer push', () => {
  it('grows without dropping under capacity', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 8 })
    const r = rb.push(ramp(3))
    expect(r).toEqual({ dropped: 0, overflow: false })
    expect(rb.length).toBe(3)
    expect(rb.dropped).toBe(0)
    expect(rb.highWater).toBe(false)
  })

  it('reaches highWater exactly at capacity with no drop', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 4 })
    const r = rb.push(ramp(4))
    expect(r).toEqual({ dropped: 0, overflow: false })
    expect(rb.length).toBe(4)
    expect(rb.highWater).toBe(true)
    expect(rb.dropped).toBe(0)
  })

  it('drops oldest past capacity and retains the newest content', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 4 })
    const r = rb.push(ramp(6)) // 0..5, length 6 > cap 4
    expect(r).toEqual({ dropped: 2, overflow: true })
    expect(rb.length).toBe(4)
    expect(rb.dropped).toBe(2)
    expect(rb.highWater).toBe(true)
    expect(Array.from(rb.drain())).toEqual([2, 3, 4, 5])
  })

  it('drops oldest when a fitting frame overflows a full buffer', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 4 })
    rb.push(ramp(4)) // [0,1,2,3]
    const r = rb.push(ramp(2, 4)) // [4,5]
    expect(r).toEqual({ dropped: 2, overflow: true })
    expect(rb.length).toBe(4)
    expect(Array.from(rb.drain())).toEqual([2, 3, 4, 5])
  })

  it('keeps only the tail of a frame larger than the whole capacity', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 4 })
    const r = rb.push(ramp(6)) // fresh buffer
    expect(r.dropped).toBe(2) // 6 - 4
    expect(Array.from(rb.drain())).toEqual([2, 3, 4, 5])
  })

  it('counts oversize-frame drops plus displaced samples', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 4 })
    rb.push(ramp(2)) // [0,1] pre-existing
    const r = rb.push(ramp(6, 10)) // [10..15], length 6 > cap 4
    // frame.length - cap = 2, plus 2 displaced from the pre-existing content
    expect(r).toEqual({ dropped: 4, overflow: true })
    expect(rb.dropped).toBe(4)
    expect(Array.from(rb.drain())).toEqual([12, 13, 14, 15])
  })
})

describe('SampleRingBuffer read / drain', () => {
  it('reads min(n, length) in FIFO order and advances start', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 8 })
    rb.push(ramp(5)) // 0..4
    expect(Array.from(rb.read(3))).toEqual([0, 1, 2])
    expect(rb.length).toBe(2)
    expect(Array.from(rb.read(10))).toEqual([3, 4])
    expect(rb.length).toBe(0)
  })

  it('reads contiguously across the circular seam', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 4 })
    rb.push(ramp(4)) // [0,1,2,3] start=0
    rb.read(2) // consume 0,1 -> start=2
    rb.push(ramp(2, 4)) // [4,5] wrap-written into slots 0,1
    expect(rb.length).toBe(4)
    expect(Array.from(rb.read(4))).toEqual([2, 3, 4, 5])
  })

  it('read(0) returns an empty Float32Array without advancing', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 4 })
    rb.push(ramp(2))
    const out = rb.read(0)
    expect(out).toBeInstanceOf(Float32Array)
    expect(out.length).toBe(0)
    expect(rb.length).toBe(2)
  })

  it('read on an empty buffer returns empty and does not throw', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 4 })
    const out = rb.read(3)
    expect(out).toBeInstanceOf(Float32Array)
    expect(out.length).toBe(0)
    expect(rb.length).toBe(0)
  })

  it('drain returns everything in order and empties the buffer', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 8 })
    rb.push(ramp(5))
    rb.read(2) // advance start so drain must respect the offset
    rb.push(ramp(2, 5)) // [5,6]
    expect(Array.from(rb.drain())).toEqual([2, 3, 4, 5, 6])
    expect(rb.length).toBe(0)
    // start reset to 0: next push reads back cleanly from index 0
    rb.push(ramp(3, 100))
    expect(Array.from(rb.drain())).toEqual([100, 101, 102])
  })
})

describe('SampleRingBuffer getters / reset', () => {
  it('reports capacity as a constant', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 16 })
    expect(rb.capacity).toBe(16)
    rb.push(ramp(4))
    expect(rb.capacity).toBe(16)
  })

  it('keeps length / dropped / highWater consistent through a mix of ops', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 4 })
    rb.push(ramp(4)) // full
    expect(rb.highWater).toBe(true)
    rb.read(1) // length 3
    expect(rb.highWater).toBe(false)
    expect(rb.length).toBe(3)
    rb.push(ramp(3, 4)) // drops 2 (length 3 + 3 = 6 > cap 4)
    expect(rb.dropped).toBe(2)
    expect(rb.length).toBe(4)
    expect(rb.highWater).toBe(true)
  })

  it('reset clears length and the dropped counter', () => {
    const rb = new SampleRingBuffer({ capacitySamples: 4 })
    rb.push(ramp(6)) // drops 2
    expect(rb.dropped).toBe(2)
    rb.reset()
    expect(rb.length).toBe(0)
    expect(rb.dropped).toBe(0)
    expect(rb.highWater).toBe(false)
    // start reset too
    rb.push(ramp(2, 9))
    expect(Array.from(rb.drain())).toEqual([9, 10])
  })

  it('uses the default config when constructed with no args', () => {
    const rb = new SampleRingBuffer()
    expect(rb.capacity).toBe(SAMPLE_RATE * 10)
  })
})

describe('FrameSource', () => {
  const F = defaultVadConfig().frameSamples // 512
  it('confirms the VAD defaults this suite relies on', () => {
    const cfg = defaultVadConfig()
    expect(cfg.frameSamples).toBe(512)
    expect(cfg.minSpeechFrames).toBe(4)
    expect(cfg.hangoverFrames).toBe(40)
  })

  it('buffers sub-frame ingests until a full frame accumulates', () => {
    const fs = new FrameSource()
    const r1 = fs.ingest(speechFrame(300))
    expect(r1.events).toEqual([])
    expect(fs.backlog).toBe(300)
    const r2 = fs.ingest(speechFrame(212)) // 300 + 212 = 512
    expect(r2.events).toEqual([]) // one speech frame, below minSpeechFrames
    expect(fs.backlog).toBe(0)
  })

  it('emits utteranceStart once minSpeechFrames of speech cross', () => {
    const fs = new FrameSource()
    const r = fs.ingest(speechFrame(F * 4)) // 4 whole speech frames in one call
    expect(r.events).toEqual(['utteranceStart'])
    expect(r.dropped).toBe(0)
    expect(fs.inUtterance).toBe(true)
    expect(fs.backlog).toBe(0)
  })

  it('processes multiple whole frames in a single ingest and leaves the partial as backlog', () => {
    const fs = new FrameSource()
    const r = fs.ingest(speechFrame(F * 4 + 100))
    expect(r.events).toEqual(['utteranceStart'])
    expect(fs.backlog).toBe(100)
    // the leftover partial is consumed by the next ingest
    fs.ingest(silenceFrame(F - 100)) // completes the 5th frame (mostly silence)
    expect(fs.backlog).toBe(0)
  })

  it('returns dropped reflecting ring overflow', () => {
    const fs = new FrameSource(defaultFrameSourceConfig({ ring: ringCfg({ capacitySamples: 1024 }) }))
    const r = fs.ingest(speechFrame(2048)) // 2048 > cap 1024 -> drops 1024
    expect(r.dropped).toBe(1024)
    expect(fs.droppedSamples).toBe(1024)
    expect(fs.backlog).toBe(0) // 1024 retained, drained as two 512 frames
  })

  it('runs a full speech -> silence(hangover) cycle to utteranceEnd', () => {
    const fs = new FrameSource()
    const start = fs.ingest(speechFrame(F * 4))
    expect(start.events).toEqual(['utteranceStart'])
    expect(fs.inUtterance).toBe(true)
    const end = fs.ingest(silenceFrame(F * 40)) // hangoverFrames silence
    expect(end.events).toEqual(['utteranceEnd'])
    expect(fs.inUtterance).toBe(false)
  })

  it('does not end the utterance one frame short of hangover', () => {
    const fs = new FrameSource()
    fs.ingest(speechFrame(F * 4))
    const almost = fs.ingest(silenceFrame(F * 39))
    expect(almost.events).toEqual([])
    expect(fs.inUtterance).toBe(true)
  })

  it('reset clears VAD state, backlog and dropped', () => {
    const fs = new FrameSource(defaultFrameSourceConfig({ ring: ringCfg({ capacitySamples: 1024 }) }))
    fs.ingest(speechFrame(2048)) // dropped + utterance progress
    fs.ingest(speechFrame(F * 4)) // enter utterance
    fs.ingest(speechFrame(100)) // leave a partial backlog
    expect(fs.backlog).toBe(100)
    expect(fs.droppedSamples).toBeGreaterThan(0)
    fs.reset()
    expect(fs.inUtterance).toBe(false)
    expect(fs.backlog).toBe(0)
    expect(fs.droppedSamples).toBe(0)
    // fresh utterance can start again after reset. Note: with a 1024-sample ring,
    // each 2048-sample ingest is truncated to the last 1024 -> only 2 frames reach
    // the VAD, so it takes two ingests to accumulate minSpeechFrames (4).
    expect(fs.ingest(speechFrame(F * 4)).events).toEqual([])
    expect(fs.ingest(speechFrame(F * 4)).events).toEqual(['utteranceStart'])
  })
})
