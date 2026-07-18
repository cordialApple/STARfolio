import { SteeringLoop, type SteeringLoopDeps } from './loop'
import { SteeringRegistry, steeringRegistry } from './registry'

export interface StartSteeringLoopDeps extends SteeringLoopDeps {
  sessionId: string
  cadence: number
  registry?: SteeringRegistry
  now?: () => number
}

export interface SteeringHandle {
  loop: SteeringLoop
  dispose: () => void
}

export function startSteeringLoop(deps: StartSteeringLoopDeps): SteeringHandle {
  const registry = deps.registry ?? steeringRegistry
  const now = deps.now ?? Date.now
  const loop = new SteeringLoop({ view: deps.view, evaluate: deps.evaluate })
  registry.register(deps.sessionId, loop)
  // Steering is best-effort: a failed background eval must never break the mic path,
  // and the turn still falls back to inline evaluation.
  const timer = setInterval(() => void loop.run(now()).catch(() => {}), deps.cadence)
  return {
    loop,
    dispose: (): void => {
      clearInterval(timer)
      registry.clear(deps.sessionId)
    }
  }
}
