import fc from 'fast-check'
import { authorityOf, COVERAGE_DIMENSIONS, type DirectedAction, type InterviewAction } from '../../roadmap'

export const intentArb: fc.Arbitrary<InterviewAction> = fc.oneof(
  fc.constant<InterviewAction>({ kind: 'ask_intro' }),
  fc.record({
    kind: fc.constant<'probe'>('probe'),
    topicId: fc.string({ minLength: 1 }),
    dimension: fc.constantFrom(...COVERAGE_DIMENSIONS),
    reason: fc.string()
  }),
  fc.record({
    kind: fc.constant<'transition'>('transition'),
    topicId: fc.string({ minLength: 1 }),
    callback: fc.boolean(),
    reason: fc.string()
  }),
  fc.constant<InterviewAction>({ kind: 'closing' }),
  fc.constant<InterviewAction>({ kind: 'done' })
)

const directedArb: fc.Arbitrary<DirectedAction> = intentArb.map((intent) => ({
  intent,
  authority: authorityOf(intent)
}))

export const planArb: fc.Arbitrary<DirectedAction[]> = fc.array(directedArb, { maxLength: 10 })

export const planWithCommandArb: fc.Arbitrary<DirectedAction[]> = fc
  .tuple(planArb, directedArb.filter((d) => d.authority === 'command'), fc.nat())
  .map(([plan, command, at]) => {
    const i = plan.length === 0 ? 0 : at % (plan.length + 1)
    return [...plan.slice(0, i), command, ...plan.slice(i)]
  })

export { fc }
