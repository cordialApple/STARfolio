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
| [voice.md](architecture/voice.md) | Push-to-talk v1 (Stage 6) → streaming v2 (Stage 6b): VAD, sliding-window whisper, revisable partials, half-duplex TTS; rejected Web Speech + translation scope; whisper fallback ladder |
| [full-duplex-migration.md](architecture/full-duplex-migration.md) | Committed Kyutai streaming-STT swap (Stage A → [6c](stages/stage-06c-streaming-stt-swap.md)) superseding the whisper front end; cascade (Stage B → [6d](stages/stage-06d-cascade-streaming-tts.md)) vs native full-duplex Moshi (Stage C → [6e](stages/stage-06e-native-full-duplex.md)); pipeline diagrams, tiered-reasoning avenues, cost/benefit ledger |
| [privacy-and-risks.md](architecture/privacy-and-risks.md) | Data locality, network egress, backups; risks & fallbacks table |
| [auth.md](architecture/auth.md) | Anthropic credential strategy: Console key primary, SDK/OAuth-profile fallback, rejected subscription/proxy paths |
