import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import { getDb, initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'
import { getStory } from '../../src/main/db/repositories/stories'

function insertRawStory(promptJson: string, idsJson: string): string {
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO stories (id, kind, prompt_json, content, experience_ids_json, parent_story_id, notes)
       VALUES (?, 'story', ?, ?, ?, NULL, NULL)`
    )
    .run(id, promptJson, 'a grounded story', idsJson)
  return id
}

describe('getStory parse fallbacks', () => {
  beforeEach(() => initDb(':memory:'))

  it('falls back to a default prompt when prompt_json is malformed', () => {
    const id = insertRawStory('{not valid json', '[]')
    expect(getStory(id)?.prompt).toEqual({
      kind: 'jd',
      promptText: '',
      length: 'medium',
      tone: 'professional'
    })
  })

  it('fills prompt defaults from a partial but valid prompt_json', () => {
    const id = insertRawStory(JSON.stringify({ promptText: 'hi', tone: 'confident' }), '[]')
    expect(getStory(id)?.prompt).toEqual({
      kind: 'jd',
      promptText: 'hi',
      length: 'medium',
      tone: 'confident'
    })
  })

  it('yields no experiences when experience_ids_json is malformed', () => {
    const id = insertRawStory('{}', '[oops')
    expect(getStory(id)?.experiences).toEqual([])
  })

  it('ignores an experience_ids_json payload that is not an array', () => {
    const id = insertRawStory('{}', '"nope"')
    expect(getStory(id)?.experiences).toEqual([])
  })

  it('keeps only live string ids and drops non-string entries', () => {
    const live = createExperience({ title: 'shipped it' } as unknown).id
    const id = insertRawStory('{}', JSON.stringify([live, 42, null, 'ghost']))
    expect(getStory(id)?.experiences).toEqual([{ id: live, title: 'shipped it' }])
  })
})
