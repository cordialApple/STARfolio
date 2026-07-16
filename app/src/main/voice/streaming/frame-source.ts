import { EnergyVad, defaultVadConfig } from './vad'
import { SampleRingBuffer, defaultRingBufferConfig } from './ring-buffer'
import type { RingBufferConfig } from './ring-buffer'
import type { VadConfig, VadEvent } from './types'

export interface FrameSourceConfig {
  vad: VadConfig
  ring: RingBufferConfig
}

export function defaultFrameSourceConfig(overrides: Partial<FrameSourceConfig> = {}): FrameSourceConfig {
  return { vad: defaultVadConfig(), ring: defaultRingBufferConfig(), ...overrides }
}

export interface FrameIngest {
  events: VadEvent[]
  dropped: number
}

export type FrameObserver = (frame: Float32Array, events: VadEvent[]) => void

export class FrameSource {
  private readonly vad: EnergyVad
  private readonly ring: SampleRingBuffer
  private readonly frameSamples: number

  constructor(
    config: FrameSourceConfig = defaultFrameSourceConfig(),
    private readonly observer?: FrameObserver
  ) {
    this.vad = new EnergyVad(config.vad)
    this.ring = new SampleRingBuffer(config.ring)
    this.frameSamples = config.vad.frameSamples
  }

  ingest(samples: Float32Array): FrameIngest {
    const { dropped } = this.ring.push(samples)
    const events: VadEvent[] = []
    while (this.ring.length >= this.frameSamples) {
      const frame = this.ring.read(this.frameSamples)
      const frameEvents = this.vad.process(frame)
      this.observer?.(frame, frameEvents)
      events.push(...frameEvents)
    }
    return { events, dropped }
  }

  get inUtterance(): boolean {
    return this.vad.inUtterance
  }

  get droppedSamples(): number {
    return this.ring.dropped
  }

  get backlog(): number {
    return this.ring.length
  }

  reset(): void {
    this.vad.reset()
    this.ring.reset()
  }
}
