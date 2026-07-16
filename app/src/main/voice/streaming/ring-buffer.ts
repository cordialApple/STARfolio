import { SAMPLE_RATE } from './types'

export interface RingBufferConfig {
  capacitySamples: number
}

export function defaultRingBufferConfig(overrides: Partial<RingBufferConfig> = {}): RingBufferConfig {
  return { capacitySamples: SAMPLE_RATE * 10, ...overrides }
}

export interface PushResult {
  dropped: number
  overflow: boolean
}

export class SampleRingBuffer {
  private data: Float32Array
  private start = 0
  private count = 0
  private droppedTotal = 0

  constructor(config: RingBufferConfig = defaultRingBufferConfig()) {
    this.data = new Float32Array(config.capacitySamples)
  }

  push(frame: Float32Array): PushResult {
    const cap = this.data.length
    let src = frame
    let dropped = 0
    if (src.length > cap) {
      dropped += src.length - cap
      src = src.subarray(src.length - cap)
    }
    const room = cap - this.count
    if (src.length > room) {
      dropped += src.length - room
      this.advance(src.length - room)
    }
    for (let i = 0; i < src.length; i++) {
      this.data[(this.start + this.count) % cap] = src[i]
      this.count++
    }
    this.droppedTotal += dropped
    return { dropped, overflow: dropped > 0 }
  }

  drain(): Float32Array {
    const out = this.peek(this.count)
    this.start = 0
    this.count = 0
    return out
  }

  read(n: number): Float32Array {
    const take = Math.min(n, this.count)
    const out = this.peek(take)
    this.advance(take)
    return out
  }

  get length(): number {
    return this.count
  }

  get capacity(): number {
    return this.data.length
  }

  get dropped(): number {
    return this.droppedTotal
  }

  get highWater(): boolean {
    return this.count >= this.data.length
  }

  reset(): void {
    this.start = 0
    this.count = 0
    this.droppedTotal = 0
  }

  private peek(n: number): Float32Array {
    const cap = this.data.length
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = this.data[(this.start + i) % cap]
    return out
  }

  private advance(n: number): void {
    const step = Math.min(n, this.count)
    this.start = (this.start + step) % this.data.length
    this.count -= step
  }
}
