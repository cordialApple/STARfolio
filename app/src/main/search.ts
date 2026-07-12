import { getDb } from './db/client'
import { embed } from './embed'
import {
  listExperiences,
  toFtsMatchQuery,
  type ExperienceSummary,
  type ListFilter
} from './db/repositories/experiences'

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
