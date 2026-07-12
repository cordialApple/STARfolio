# Architecture — Privacy, Durability & Risks

Part of the [architecture spec](../architecture.md)

## Privacy & durability

All data in one SQLite file under `userData`; the only network egress is the Anthropic API (user's own key), the one-time embedding/whisper model downloads, and user-initiated URL/repo fetches. API key via DPAPI, never in the renderer, never logged. Backup = copy the DB file (surfaced in Settings), plus JSON export (Stage 10). No telemetry.

## Risks & fallbacks

| Risk | Mitigation |
|---|---|
| sqlite-vec pre-1.0 API churn | pin version; wrapped behind `search/`; LanceDB is the named fallback if scale/API breaks |
| `smart-whisper` ABI pain in Electron | Stage-0 spike decides; sidecar whisper.cpp binary is the ladder's next rung |
| PDF extraction quality on real resumes | Stage-6 fixture corpus of real files; scanned PDFs explicitly out of scope v1 |
| Streaming voice harder than expected | push-to-talk ships first and is independently good (Checkpoint 5a stands alone) |
| Stage-2.5 retrieval eval fails on abstract themed queries | pre-named ladder: Haiku query expansion → larger embedding model (bge-base) → LLM rerank |
| Model IDs/pricing rotate | single routing config module; usage_log makes cost drift visible |
| LLM invents details | grounding rules + provenance links + gaps-not-fills are spec'd into every generation prompt and its UI |
| Anthropic auth/billing policy churn (subscription OAuth banned, Agent SDK terms whipsawed in 2026) | Console API key is the primary credential — stable terms; alternatives isolated behind the `AiTransport` seam ([auth.md](auth.md)) |
