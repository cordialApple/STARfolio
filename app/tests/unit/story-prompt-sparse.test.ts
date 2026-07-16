import { describe, expect, it } from 'vitest'
import { buildStoryPrompt, storyConfig, type StoryConfig } from '../../src/main/ai/story'
import type { Experience } from '../../src/main/db/repositories/experiences'

function cfg(over: Partial<StoryConfig>): StoryConfig {
  return storyConfig.parse({
    requestId: '00000000-0000-0000-0000-000000000000',
    experienceIds: ['x'],
    promptText: 'Backend engineer who ships reliable systems',
    ...over
  })
}

function exp(over: Partial<Experience>): Experience {
  return {
    id: 'e1',
    title: '',
    situation: '',
    task: '',
    action: '',
    result_text: '',
    context: 'work',
    happened_start: null,
    happened_end: null,
    status: 'confirmed',
    draft_state_json: null,
    created_at: '',
    updated_at: '',
    skills: [],
    tags: [],
    metrics: [],
    sources: [],
    ...over
  }
}

describe('buildStoryPrompt sparse experiences and notes', () => {
  it('labels a titleless experience Untitled and formats metrics missing value or unit', () => {
    const e = exp({
      metrics: [
        { id: 'm1', label: 'latency', value: null, unit: null },
        { id: 'm2', label: 'errors', value: 3, unit: null }
      ]
    })
    const { prompt } = buildStoryPrompt(cfg({}), [e])
    expect(prompt).toContain('Untitled')
    expect(prompt).toContain('latency')
    expect(prompt).toContain('errors 3')
    expect(prompt).not.toContain('Action:')
  })

  it('includes guidance notes when provided', () => {
    const { prompt } = buildStoryPrompt(cfg({ notes: 'keep it humble' }), [
      exp({ title: 'Ship it', action: 'did the work' })
    ])
    expect(prompt).toContain('keep it humble')
    expect(prompt).toContain('Additional guidance')
  })
})
