import { describe, it, expect, beforeEach } from 'vitest'
import { initDb } from '../../src/main/db/client'
import { createExperience, deleteExperience } from '../../src/main/db/repositories/experiences'
import { saveStory, getStory, listStories } from '../../src/main/db/repositories/stories'

function seed(title: string): string {
  return createExperience({ title, action: `did ${title}`, context: 'work', status: 'confirmed' } as unknown)
    .id
}

describe('stories repository', () => {
  beforeEach(() => initDb(':memory:'))

  it('persists a story with provenance and reads it back', () => {
    const a = seed('led the migration')
    const b = seed('mentored an intern')
    const story = saveStory({
      content: 'Once I led a migration and mentored an intern.',
      experienceIds: [a, b],
      prompt: { kind: 'jd', promptText: 'Staff engineer', length: 'medium', tone: 'professional' }
    })
    expect(story.experiences.map((e) => e.title)).toEqual(['led the migration', 'mentored an intern'])

    const got = getStory(story.id)
    expect(got?.content).toContain('led a migration')
    expect(got?.prompt.promptText).toBe('Staff engineer')
    expect(got?.experiences).toHaveLength(2)
  })

  it('drops provenance links to experiences that no longer exist', () => {
    const a = seed('shipped a feature')
    const b = seed('to be deleted')
    const story = saveStory({
      content: 'A grounded story.',
      experienceIds: [a, b],
      prompt: { kind: 'genre', promptText: 'Teamwork', length: 'short', tone: 'confident' }
    })
    deleteExperience(b)
    const got = getStory(story.id)
    expect(got?.experiences.map((e) => e.id)).toEqual([a])
  })

  it('refuses to save when no linked experience exists', () => {
    expect(() =>
      saveStory({
        content: 'Ungrounded.',
        experienceIds: ['ghost'],
        prompt: { kind: 'jd', promptText: 'x', length: 'medium', tone: 'professional' }
      })
    ).toThrow(/still exist/)
  })

  it('records regenerate-with-notes lineage and lists newest first', () => {
    const a = seed('the experience')
    const first = saveStory({
      content: 'First take.',
      experienceIds: [a],
      prompt: { kind: 'jd', promptText: 'x', length: 'medium', tone: 'professional' }
    })
    const second = saveStory({
      content: 'Second take, punchier.',
      experienceIds: [a],
      prompt: { kind: 'jd', promptText: 'x', length: 'medium', tone: 'professional' },
      notes: 'lead with the metric',
      parentStoryId: first.id
    })
    expect(getStory(second.id)?.parent_story_id).toBe(first.id)
    expect(getStory(second.id)?.notes).toBe('lead with the metric')

    const list = listStories()
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe(second.id)
  })
})
