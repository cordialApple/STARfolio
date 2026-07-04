# STARfolio — Architecture Spec (index)

Companion docs: [concept & user stories](starfolio-concept.md) · [build plan](build-plan.md). The spec lives in topic files under [`architecture/`](architecture/) — each stage file names exactly the topics it needs; load only those.

| Topic | Covers |
|---|---|
| [overview.md](architecture/overview.md) | Context, locked decisions, Electron-over-Tauri rationale, full stack table |
| [process-and-ipc.md](architecture/process-and-ipc.md) | Main/renderer module layout, security boundary, worker threading, stream cancellation |
| [data-model.md](architecture/data-model.md) | Full SQLite schema (entities, provenance, practice, search layer), graph-model rationale |
| [retrieval.md](architecture/retrieval.md) | Hybrid FTS5+vector search with RRF, embed-on-write queue, model manager |
| [ai-layer.md](architecture/ai-layer.md) | Model routing, structured output, prompt caching, grounding rules, record/replay test seam, cost |
| [ingestion.md](architecture/ingestion.md) | Extractor pipeline, per-format build order, repo-tarball rationale |
| [voice.md](architecture/voice.md) | Push-to-talk v1 → streaming v2, rejected Web Speech, whisper fallback ladder |
| [privacy-and-risks.md](architecture/privacy-and-risks.md) | Data locality, network egress, backups; risks & fallbacks table |
