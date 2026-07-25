import type { DirectedAction, InterviewAction } from '../roadmap'

export interface Mouth {
  readonly id: string
  realize(plan: DirectedAction[]): DirectedAction[]
}

export function commandsOf(plan: DirectedAction[]): InterviewAction[] {
  return plan.filter((d) => d.authority === 'command').map((d) => d.intent)
}

function eq(a: DirectedAction, b: DirectedAction): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isSubsequence(plan: DirectedAction[], realized: DirectedAction[]): boolean {
  let pi = 0
  for (const r of realized) {
    while (pi < plan.length && !eq(plan[pi], r)) pi++
    if (pi === plan.length) return false
    pi++
  }
  return true
}

export interface ConformanceResult {
  ok: boolean
  reason: string
}

export function checkSeam(plan: DirectedAction[], realized: DirectedAction[]): ConformanceResult {
  if (!isSubsequence(plan, realized)) {
    return { ok: false, reason: 'realized sequence is not an order-preserving subset of the plan' }
  }
  const planCmds = commandsOf(plan)
  const realCmds = commandsOf(realized)
  if (planCmds.length !== realCmds.length) {
    return { ok: false, reason: 'a command intent was dropped — commands must be realized at the turn boundary' }
  }
  return { ok: true, reason: 'conforms' }
}

export function conformsToSeam(plan: DirectedAction[], realized: DirectedAction[]): boolean {
  return checkSeam(plan, realized).ok
}
