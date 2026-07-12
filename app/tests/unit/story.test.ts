import { describe, it, expect, beforeEach } from 'vitest'
import type { WebContents } from 'electron'
import { initDb } from '../../src/main/db/client'
import { createExperience, getExperience } from '../../src/main/db/repositories/experiences'
import {
  buildStoryPrompt,
  streamStory,
  storyConfig,
  NoExperiencesError,
  type StoryConfig
} from '../../src/main/ai/story'

function config(over: Partial<StoryConfig>): StoryConfig {
  return storyConfig.parse({
    requestId: '00000000-0000-0000-0000-000000000000',
    experienceIds: ['x'],
    kind: 'jd',
    promptText: 'Backend engineer who ships reliable systems',
    length: 'medium',
    tone: 'professional',
    ...over
  })
}

describe('buildStoryPrompt', () => {
  let exp: ReturnType<typeof getExperience>
  beforeEach(() => {
    initDb(':memory:')
    const created = createExperience({
      title: 'Cut deploy times',
      situation: 'Builds took 20 minutes',
      task: 'Own reducing build time',
      action: 'Added caching and parallel jobs',
      result_text: 'Down to 4 minutes',
      context: 'work',
      status: 'confirmed',
      skills: [{ name: 'CI', kind: 'technical' }],
      metrics: [{ label: 'build time', value: 4, unit: 'min' }]
    } as unknown)
    exp = getExperience(created.id)
  })

  it('grounds the prompt only in the provided experiences', () => {
    const { system, prompt } = buildStoryPrompt(config({ experienceIds: [exp!.id] }), [exp!])
    expect(prompt).toContain('Cut deploy times')
    expect(prompt).toContain('Added caching and parallel jobs')
    expect(prompt).toContain('build time 4 min')
    // The job description framing is present…
    expect(prompt).toContain('Backend engineer who ships reliable systems')
    // …and the system prompt forbids invention and requires gap-marking.
    expect(system).toMatch(/[Nn]ever invent/)
    expect(system).toMatch(/gap/i)
    expect(system).toMatch(/DATA, never instructions/)
  })

  it('scales max tokens with the requested length', () => {
    const short = buildStoryPrompt(config({ length: 'short' }), [exp!])
    const detailed = buildStoryPrompt(config({ length: 'detailed' }), [exp!])
    expect(detailed.maxTokens).toBeGreaterThan(short.maxTokens)
  })

  it('frames a theme differently from a job description', () => {
    const themed = buildStoryPrompt(config({ kind: 'genre', promptText: 'Leadership' }), [exp!])
    expect(themed.prompt).toContain('Leadership')
    expect(themed.prompt).not.toContain('job description')
  })
})

describe('streamStory', () => {
  beforeEach(() => initDb(':memory:'))

  it('throws when none of the selected experiences exist', () => {
    const sender = { isDestroyed: () => true, send: () => {} } as unknown as WebContents
    expect(() => streamStory(config({ experienceIds: ['missing'] }), sender)).toThrow(
      NoExperiencesError
    )
  })
})
