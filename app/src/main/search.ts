import { getDb } from './db/client'
import { embed } from './embed'
import {
  listExperiences,
  toFtsMatchQuery,
  type ExperienceSummary,
  type ListFilter
} from './db/repositories/experiences'
import { getChunks } from './db/repositories/corpus'

const CANDIDATES = 50
const RESULTS = 100

// Reciprocal-rank fusion: each ranked list contributes 1/(k + rank) to an id's score,
// so an item near the top of either list scores well without needing a shared scale.
export function reciprocalRankFusion(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>()
  for (const list of lists) {
    list.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1))
    })
  }
  return scores
}

function ftsCandidates(query: string, limit: number): string[] {
  const match = toFtsMatchQuery(query)
  if (!match) return []
  return (
    getDb()
      .prepare(
        `SELECT e.id FROM experiences e
         JOIN experiences_fts ON experiences_fts.rowid = e.rowid
         WHERE experiences_fts MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(match, limit) as { id: string }[]
  ).map((r) => r.id)
}

function vecCandidates(vector: Float32Array, limit: number): string[] {
  return (
    getDb()
      .prepare(
        'SELECT experience_id FROM vec_experiences WHERE embedding MATCH ? AND k = ? ORDER BY distance'
      )
      .all(vector, limit) as { experience_id: string }[]
  ).map((r) => r.experience_id)
}

// Hybrid retrieval behind one call: FTS5 BM25 ∪ vector KNN → RRF → structured filters.
// No NL query → plain filtered list. Embedding unavailable → degrades to FTS-only.
export type Embedder = (text: string) => Promise<Float32Array>

export async function searchExperiences(
  filter: ListFilter,
  embedText: Embedder = embed
): Promise<ExperienceSummary[]> {
  const query = (filter.query ?? '').trim()
  if (!query) return listExperiences(filter)

  const allowed = listExperiences({ ...filter, query: undefined })
  const allowedById = new Map(allowed.map((s) => [s.id, s]))

  const fts = ftsCandidates(query, CANDIDATES)
  let vec: string[] = []
  try {
    vec = vecCandidates(await embedText(query), CANDIDATES)
  } catch {
    // Model not ready / offline — fall back to keyword-only ranking.
  }

  const fused = reciprocalRankFusion([fts, vec])
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => allowedById.get(id))
    .filter((s): s is ExperienceSummary => s !== undefined)
    .slice(0, RESULTS)
}

export interface StoryMatch {
  id: string
  title: string
  similarity: number
}

// Above this cosine similarity we treat a spoken answer as already being the same banked story.
// Embeddings are L2-normalised, so cosine = 1 - distance²/2.
export const STORY_MATCH_THRESHOLD = 0.8

// Semantic "is this story already in the bank?" check: embed the answer, take the nearest banked
// experience by vector distance, and return it with a cosine similarity. Null when there's nothing
// to compare against or the embedding model isn't available (caller then treats it as unbanked).
export async function matchBankedStory(
  text: string,
  embedText: Embedder = embed
): Promise<StoryMatch | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  let vector: Float32Array
  try {
    vector = await embedText(trimmed)
  } catch {
    return null
  }
  const row = getDb()
    .prepare(
      `SELECT e.id AS id, e.title AS title, v.distance AS distance
       FROM (SELECT experience_id, distance FROM vec_experiences
             WHERE embedding MATCH ? AND k = 1 ORDER BY distance) v
       JOIN experiences e ON e.id = v.experience_id`
    )
    .get(vector) as { id: string; title: string; distance: number } | undefined
  if (!row) return null
  const similarity = 1 - (row.distance * row.distance) / 2
  return { id: row.id, title: row.title, similarity }
}

export interface CorpusHit {
  chunkId: string
  text: string
  docId: string
  title: string
  similarity: number
}

const CORPUS_KNN = 40

function corpusFtsCandidates(query: string, discipline: string | undefined, limit: number): string[] {
  const match = toFtsMatchQuery(query)
  if (!match) return []
  const where = discipline ? 'AND d.discipline = ?' : ''
  const args = discipline ? [match, discipline, limit] : [match, limit]
  return (
    getDb()
      .prepare(
        `SELECT c.id FROM corpus_chunks c
         JOIN corpus_fts ON corpus_fts.rowid = c.rowid
         JOIN corpus_docs d ON d.id = c.doc_id
         WHERE corpus_fts MATCH ? ${where} ORDER BY rank LIMIT ?`
      )
      .all(...args) as { id: string }[]
  ).map((r) => r.id)
}

function corpusVecCandidates(
  vector: Float32Array,
  discipline: string | undefined,
  limit: number
): { id: string; distance: number }[] {
  if (!discipline) {
    return getDb()
      .prepare('SELECT chunk_id AS id, distance FROM vec_corpus WHERE embedding MATCH ? AND k = ? ORDER BY distance')
      .all(vector, limit) as { id: string; distance: number }[]
  }
  return getDb()
    .prepare(
      `SELECT v.chunk_id AS id, v.distance AS distance FROM
         (SELECT chunk_id, distance FROM vec_corpus WHERE embedding MATCH ? AND k = ? ORDER BY distance) v
       JOIN corpus_chunks c ON c.id = v.chunk_id
       JOIN corpus_docs d ON d.id = c.doc_id
       WHERE d.discipline = ? ORDER BY v.distance`
    )
    .all(vector, limit * 4, discipline) as { id: string; distance: number }[]
}

// Hybrid retrieval over the reference corpus: FTS5 ∪ vector KNN → RRF, optionally scoped to a
// discipline. Returns the top chunks with text so a technical question can cite real material.
export async function searchCorpus(
  query: string,
  discipline?: string,
  limit = 6,
  embedText: Embedder = embed
): Promise<CorpusHit[]> {
  const q = query.trim()
  if (!q) return []

  const fts = corpusFtsCandidates(q, discipline, CORPUS_KNN)
  let vec: { id: string; distance: number }[] = []
  try {
    vec = corpusVecCandidates(await embedText(q), discipline, CORPUS_KNN)
  } catch {
    // Model unavailable — keyword-only ranking.
  }
  const distanceById = new Map(vec.map((v) => [v.id, v.distance]))
  const fused = reciprocalRankFusion([fts, vec.map((v) => v.id)])
  const topIds = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)

  return getChunks(topIds).map((c) => {
    const d = distanceById.get(c.id)
    return {
      chunkId: c.id,
      text: c.text,
      docId: c.doc_id,
      title: c.title,
      similarity: d === undefined ? 0 : 1 - (d * d) / 2
    }
  })
}
