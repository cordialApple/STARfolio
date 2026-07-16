import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import {
  generateStoryText,
  NoExperiencesError,
  storyConfig,
  type StoryConfig
} from '../../src/main/ai/story'

function config(over: Partial<StoryConfig>): StoryConfig {
  return storyConfig.parse({
    requestId: '00000000-0000-0000-0000-000000000000',
    experienceIds: ['x'],
    promptText: 'Backend engineer who ships reliable systems',
    ...over
  })
}

const signal = (): AbortSignal => new AbortController().signal

beforeEach(() => {
  initDb(':memory:')
  vi.stubEnv('STARFOLIO_AI_STUB', '1')
})
afterEach(() => vi.unstubAllEnvs())

describe('generateStoryText', () => {
  it('returns a grounded story plus the resolved experience ids', async () => {
    const e = createExperience({ title: 'Cut deploy times', action: 'added caching' })
    const out = await generateStoryText(config({ experienceIds: [e.id] }), signal())
    expect(out.experienceIds).toEqual([e.id])
    expect(out.story).toContain('Cut deploy times')
    expect(out.story).toContain('Backend engineer who ships reliable systems')
  })

  it('drops ids that no longer exist', async () => {
    const e = createExperience({ title: 'Shipped it', action: 'a' })
    const out = await generateStoryText(config({ experienceIds: [e.id, 'gone'] }), signal())
    expect(out.experienceIds).toEqual([e.id])
  })

  it('rejects with NoExperiencesError when nothing resolves', async () => {
    await expect(
      generateStoryText(config({ experienceIds: ['missing'] }), signal())
    ).rejects.toThrow(NoExperiencesError)
  })
})
