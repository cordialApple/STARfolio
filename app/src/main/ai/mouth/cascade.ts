import type { Mouth } from './conformance'

export const cascadeMouth: Mouth = {
  id: 'cascade',
  realize(plan) {
    return plan.map((d) => ({ ...d }))
  }
}
