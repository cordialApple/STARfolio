import { randomUUID } from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb } from '../../src/main/db/client'
import { getStory } from '../../src/main/db/repositories/stories'

beforeEach(() => initDb(':memory:'))

describe('getStory null columns and missing id', () => {
  it('uses defaults when prompt_json and experience_ids_json are null', () => {
    const id = randomUUID()
    getDb()
      .prepare(`INSERT INTO stories (id, kind, content) VALUES (?, 'story', ?)`)
      .run(id, 'a grounded story')
    const story = getStory(id)!
    expect(story.prompt).toEqual({ kind: 'jd', promptText: '', length: 'medium', tone: 'professional' })
    expect(story.experiences).toEqual([])
  })

  it('returns null for an id that has no story', () => {
    expect(getStory('ghost-story')).toBeNull()
  })
})
