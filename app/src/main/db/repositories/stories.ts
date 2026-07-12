import { randomUUID } from 'crypto'
import { z } from 'zod'
import { getDb } from '../client'
import { STORY_LENGTHS, STORY_TONES } from '../../ai/story'

export const storyPrompt = z.object({
  kind: z.enum(['jd', 'genre']).default('jd'),
  promptText: z.string().trim().max(20_000).default(''),
  length: z.enum(STORY_LENGTHS).default('medium'),
  tone: z.enum(STORY_TONES).default('professional')
})

export const storySaveInput = z.object({
  content: z.string().trim().min(1).max(50_000),
  experienceIds: z.array(z.string().min(1).max(64)).min(1).max(12),
  prompt: storyPrompt,
  notes: z.string().trim().max(4000).nullable().optional(),
  parentStoryId: z.string().min(1).max(64).nullable().optional()
})

export type StoryPrompt = z.infer<typeof storyPrompt>
export type StorySaveInput = z.infer<typeof storySaveInput>

export interface StoryExperienceRef {
  id: string
  title: string
}
export interface Story {
  id: string
  content: string
  prompt: StoryPrompt
  notes: string | null
  parent_story_id: string | null
  created_at: string
  experiences: StoryExperienceRef[]
}
export interface StorySummary {
  id: string
  snippet: string
  prompt: StoryPrompt
  created_at: string
  experiences: StoryExperienceRef[]
}

// Provenance must point at experiences that actually exist — a deleted experience can't be
// a source. Filter the claimed ids down to live rows and keep their titles for "built from".
function liveExperiences(ids: string[]): StoryExperienceRef[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  const rows = getDb()
    .prepare(`SELECT id, title FROM experiences WHERE id IN (${placeholders})`)
    .all(...ids) as StoryExperienceRef[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is StoryExperienceRef => r !== undefined)
}

export function saveStory(raw: unknown): Story {
  const input = storySaveInput.parse(raw)
  const refs = liveExperiences(input.experienceIds)
  if (refs.length === 0) throw new Error('None of the linked experiences still exist')

  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO stories (id, kind, prompt_json, content, experience_ids_json, parent_story_id, notes)
       VALUES (?, 'story', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      JSON.stringify(input.prompt),
      input.content,
      JSON.stringify(refs.map((r) => r.id)),
      input.parentStoryId ?? null,
      input.notes ?? null
    )
  return getStory(id)!
}

function parsePrompt(json: string | null): StoryPrompt {
  try {
    return storyPrompt.parse(JSON.parse(json ?? '{}'))
  } catch {
    return storyPrompt.parse({})
  }
}

function parseIds(json: string | null): string[] {
  try {
    const arr = JSON.parse(json ?? '[]')
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function getStory(id: string): Story | null {
  const row = getDb()
    .prepare(
      `SELECT id, prompt_json, content, experience_ids_json, parent_story_id, notes, created_at
       FROM stories WHERE id = ? AND kind = 'story'`
    )
    .get(id) as
    | {
        id: string
        prompt_json: string | null
        content: string
        experience_ids_json: string | null
        parent_story_id: string | null
        notes: string | null
        created_at: string
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    content: row.content,
    prompt: parsePrompt(row.prompt_json),
    notes: row.notes,
    parent_story_id: row.parent_story_id,
    created_at: row.created_at,
    experiences: liveExperiences(parseIds(row.experience_ids_json))
  }
}

export function listStories(): StorySummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, prompt_json, content, experience_ids_json, created_at
       FROM stories WHERE kind = 'story' ORDER BY created_at DESC, rowid DESC LIMIT 200`
    )
    .all() as {
    id: string
    prompt_json: string | null
    content: string
    experience_ids_json: string | null
    created_at: string
  }[]
  return rows.map((r) => ({
    id: r.id,
    snippet: r.content.slice(0, 240),
    prompt: parsePrompt(r.prompt_json),
    created_at: r.created_at,
    experiences: liveExperiences(parseIds(r.experience_ids_json))
  }))
}
