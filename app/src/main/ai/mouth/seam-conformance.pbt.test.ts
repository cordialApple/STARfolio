import { describe, it, expect } from 'vitest'
import { runProperty } from '../../voice/pbt/pbt'
import { cascadeMouth } from './cascade'
import { conformsToSeam, type Mouth } from './conformance'
import { planArb, planWithCommandArb } from './pbt/arbitraries'

const jsonEq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const dropSteersMouth: Mouth = {
  id: 'drop-steers',
  realize: (plan) => plan.filter((d) => d.authority === 'command')
}

const dropFirstCommandMouth: Mouth = {
  id: 'drop-first-command',
  realize: (plan) => {
    const i = plan.findIndex((d) => d.authority === 'command')
    return i < 0 ? plan : [...plan.slice(0, i), ...plan.slice(i + 1)]
  }
}

const reverseMouth: Mouth = {
  id: 'reverse',
  realize: (plan) => [...plan].reverse()
}

const fabricateMouth: Mouth = {
  id: 'fabricate',
  realize: (plan) => [...plan, { intent: { kind: 'done' }, authority: 'command' }]
}

describe('seam conformance (6d.2c)', () => {
  it('cascade mouth always conforms (identity realization)', () => {
    runProperty('cascade-conforms', planArb, (plan) => conformsToSeam(plan, cascadeMouth.realize(plan)))
  })

  it('a steer-dropping mouth conforms (steers may be dropped)', () => {
    runProperty('drop-steers-conforms', planArb, (plan) =>
      conformsToSeam(plan, dropSteersMouth.realize(plan))
    )
  })

  it('dropping a command breaks conformance', () => {
    runProperty('drop-command-fails', planWithCommandArb, (plan) => {
      expect(conformsToSeam(plan, dropFirstCommandMouth.realize(plan))).toBe(false)
      return true
    })
  })

  it('reordering breaks conformance when order actually changes', () => {
    runProperty('reorder-fails', planArb, (plan) => {
      const realized = reverseMouth.realize(plan)
      const reordered = !jsonEq(realized, plan)
      return !reordered || conformsToSeam(plan, realized) === false
    })
  })

  it('fabricating an intent breaks conformance', () => {
    runProperty('fabricate-fails', planArb, (plan) => {
      expect(conformsToSeam(plan, fabricateMouth.realize(plan))).toBe(false)
      return true
    })
  })

  it('cascade realization equals the plan verbatim', () => {
    runProperty('cascade-verbatim', planArb, (plan) => {
      const realized = cascadeMouth.realize(plan)
      return jsonEq(realized, plan)
    })
  })
})
