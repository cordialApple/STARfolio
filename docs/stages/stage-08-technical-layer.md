# Stage 8 — Technical-interview layer (bonus)

Part of the [build plan](../build-plan.md) · Context to load: [ingestion](../architecture/ingestion.md) · [retrieval](../architecture/retrieval.md) · [ai-layer](../architecture/ai-layer.md) · [data-model](../architecture/data-model.md)

Goal: mode A over your own reference corpus.

- [ ] 8.1 Corpus ingestion: reuse extractors → `corpus_docs`/`corpus_chunks` + chunk embeddings + FTS; corpus manager UI (add/remove, per-discipline).
- [ ] 8.2 Technical session mode: retrieve from corpus by discipline → generate a system-design/technical question → walk-through loop with discerning follow-ups probing stated design decisions; retrieved corpus-chunk IDs logged per question/follow-up (same provenance discipline as mode B).
- [ ] 8.3 Technical feedback rubric distinct from behavioral.

**Checkpoint 8**: feed in your system-design notes → get a question at their depth, with every question/follow-up citing at least one chunk from the supplied corpus.
