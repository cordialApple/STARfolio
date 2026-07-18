import type { SteeringLoop, SteeringSignal } from './loop'

export class SteeringRegistry {
  private readonly loops = new Map<string, SteeringLoop>()

  register(sessionId: string, loop: SteeringLoop): void {
    this.loops.set(sessionId, loop)
  }

  get(sessionId: string): SteeringLoop | undefined {
    return this.loops.get(sessionId)
  }

  clear(sessionId: string): void {
    this.loops.delete(sessionId)
  }

  signalFor(sessionId: string, now: number, maxAgeMs: number): SteeringSignal | null {
    const signal = this.loops.get(sessionId)?.latest()
    if (!signal) return null
    return now - signal.at <= maxAgeMs ? signal : null
  }
}

export const steeringRegistry = new SteeringRegistry()

export function registerSteeringLoop(sessionId: string, loop: SteeringLoop): void {
  steeringRegistry.register(sessionId, loop)
}

export function steeringLoopFor(sessionId: string): SteeringLoop | undefined {
  return steeringRegistry.get(sessionId)
}

export function clearSteeringLoop(sessionId: string): void {
  steeringRegistry.clear(sessionId)
}

export function steeringSignalFor(
  sessionId: string,
  now: number,
  maxAgeMs: number
): SteeringSignal | null {
  return steeringRegistry.signalFor(sessionId, now, maxAgeMs)
}
