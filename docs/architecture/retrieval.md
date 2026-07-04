# Architecture — Retrieval

Part of the [architecture spec](../architecture.md) · schema: [data-model.md](data-model.md)

One `search()` service: FTS5 BM25 top-k ∪ vector KNN top-k → reciprocal-rank fusion → structured filters (skill join, date range, context) as SQL. Embeddings are written by an embed-on-write queue whenever an experience is created/edited (and per corpus chunk on ingest); saves never block on embedding, and the queue persists pending rows across restarts, so a missing/failed model download degrades NL find gracefully instead of breaking capture. NL find ("a time I led under pressure") = the same call with the raw query; no LLM in the retrieval loop for the base case. Retrieval quality gets its own checkpoint (Stage 2) against a seeded bank.

Local model downloads (bge-small now, whisper later) go through one **model manager**: progress, retry, resume-after-kill, and error surfacing — built once in Stage 2, reused in Stage 5.
