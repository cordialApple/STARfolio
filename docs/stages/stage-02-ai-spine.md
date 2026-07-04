# Stage 2 — AI spine: brain dump & natural-language find

Part of the [build plan](../build-plan.md) · Context to load: [ai-layer](../architecture/ai-layer.md) · [retrieval](../architecture/retrieval.md) · [data-model](../architecture/data-model.md)

Goal: the two flows that make capture effortless and retrieval smart.

- [ ] 2.1 `ai/` module hardened: routing config, zod-schema parse helper, refusal/error handling, retry, usage logging, and the **record/replay test transport** all later e2e tests run against.
- [ ] 2.2 Brain dump: textarea → Haiku STAR extraction (field confidence + gaps) → propose-then-confirm review UI (accept/edit per field, answer gap questions) → saved with the dump attached as a `paste` source. Source persistence + provenance links land here (Stage 6 later generalizes them into the Extractor framework); the experience detail view now shows attached sources with raw-text preview; unanswered gaps/confidence persist in `draft_state_json` so abandoned drafts reopen mid-conversation.
- [ ] 2.3 Model manager (download progress/retry/resume/errors) + embed-on-write queue (non-blocking, persistent) + backfill for existing rows; hybrid `search()` (BM25 + KNN → RRF) behind one IPC call.
- [ ] 2.4 NL find UI: query box on the Bank; results ranked with matched-experience cards; structured filters compose on top.
- [ ] 2.5 Retrieval eval: seed a 20-experience fixture bank; 10 themed queries ("led under pressure", "handled ambiguity", …) must surface the right experience top-3.

**Checkpoint 2**: paste a messy paragraph → confirm a well-formed STAR draft in under a minute; ask a themed question → right experience in the top results.
