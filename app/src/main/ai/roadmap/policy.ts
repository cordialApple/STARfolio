import {
  coverageDebt,
  isTransitionable,
  nextDimension,
  timePressure,
  topicSaturation
} from './coverage'
import type { InterviewAction, InterviewState, Thread, Topic } from './types'

function topicById(state: InterviewState, id: string | null): Topic | null {
  if (!id) return null
  return state.roadmap.topics.find((t) => t.id === id) ?? null
}

function unfinishedTopics(state: InterviewState): Topic[] {
  return state.roadmap.topics.filter(
    (t) => topicSaturation(t, state.candidate.level) < 1
  )
}

function pickNextTopic(state: InterviewState, excludeId: string | null): Topic | null {
  const candidates = state.roadmap.topics.filter(
    (t) =>
      t.id !== excludeId && topicSaturation(t, state.candidate.level) < 1
  )
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => scoreTopic(b, state) - scoreTopic(a, state))[0]
}

function scoreTopic(topic: Topic, state: InterviewState): number {
  const debt = coverageDebt(topic, state.candidate.level)
  const freshness = topic.askedCount === 0 ? 0.5 : 0
  return topic.value + debt + freshness
}

function callbackThread(state: InterviewState, topicId: string): Thread | null {
  const forTopic = state.threads.filter((t) => t.topicId === topicId)
  if (forTopic.length === 0) return null
  return forTopic.sort((a, b) => b.value - a.value)[0]
}

function shouldClose(state: InterviewState): boolean {
  if (timePressure(state) >= 1) return true
  return unfinishedTopics(state).length === 0
}

export function selectAction(state: InterviewState): InterviewAction {
  switch (state.phase) {
    case 'intro':
      return { kind: 'ask_intro' }

    case 'closing':
      return state.closingAsked ? { kind: 'done' } : { kind: 'closing' }

    case 'done':
      return { kind: 'done' }

    case 'exploration': {
      if (shouldClose(state)) return { kind: 'closing' }

      const current = topicById(state, state.currentTopicId)
      if (current && !isTransitionable(current, state)) {
        const dim = nextDimension(current, state.candidate.level)
        if (dim) {
          return {
            kind: 'probe',
            topicId: current.id,
            dimension: dim,
            reason: `deepen ${dim} on ${current.label}`
          }
        }
      }

      const next = pickNextTopic(state, state.currentTopicId)
      if (!next) return { kind: 'closing' }

      const callback = callbackThread(state, next.id)
      return {
        kind: 'transition',
        topicId: next.id,
        callback: callback !== null,
        reason: callback
          ? `callback to unresolved thread: ${callback.note}`
          : `move to higher-value topic ${next.label}`
      }
    }
  }
}
