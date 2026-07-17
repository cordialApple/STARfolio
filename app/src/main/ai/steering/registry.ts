import type { SteeringLoop, SteeringSignal } from './loop'

const loops = new Map<string, SteeringLoop>()

export function registerSteeringLoop(sessionId: string, loop: SteeringLoop): void {
  loops.set(sessionId, loop)
}

export function steeringLoopFor(sessionId: string): SteeringLoop | undefined {
  return loops.get(sessionId)
}

export function clearSteeringLoop(sessionId: string): void {
  loops.delete(sessionId)
}

export function steeringSignalFor(
  sessionId: string,
  now: number,
  maxAgeMs: number
): SteeringSignal | null {
  const signal = loops.get(sessionId)?.latest()
  if (!signal) return null
  return now - signal.at <= maxAgeMs ? signal : null
}
