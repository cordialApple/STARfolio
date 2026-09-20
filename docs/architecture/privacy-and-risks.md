# Architecture — Privacy, Durability & Risks

Part of the [architecture spec](../architecture.md)

## Privacy & durability

Durable product data stays in one SQLite file under `userData`. The local machine owns retrieval, interview plans, scoring, reducer state, reports, and audit history. Network egress can include the selected model provider, one-time model downloads, user-initiated URL or repo fetches, and the default-off MoshiRAG path. MoshiRAG sends live session audio and selected interview context through an SSM port forward to the loopback gateway on a temporary user-controlled AWS GPU worker. The worker is session-scoped and deadline-bound; it is not a persistent STARfolio data store. Credentials never enter the renderer or logs. Backup = copy the DB file, plus JSON export. No telemetry.

## Risks & fallbacks

| Risk | Mitigation |
|---|---|
| sqlite-vec pre-1.0 API churn | pin version; wrapped behind `search/`; LanceDB is the named fallback if scale/API breaks |
| `smart-whisper` ABI pain in Electron | Stage-0 spike decides; sidecar whisper.cpp binary is the ladder's next rung |
| PDF extraction quality on real resumes | Stage-6 fixture corpus of real files; scanned PDFs explicitly out of scope v1 |
| Streaming voice harder than expected | push-to-talk ships first and is independently good (Checkpoint 5a stands alone) |
| Remote GPU worker outlives a session | absolute deadline, heartbeat/disconnect handling, explicit teardown, and lifecycle tests; live proof tracked in issue #312 |
| Remote speech path exposes more session data | default off, explicit consent, selected context only, local durable storage, and auditable session outcome |
| Stage-2.5 retrieval eval fails on abstract themed queries | pre-named ladder: Haiku query expansion → larger embedding model (bge-base) → LLM rerank |
| Model IDs/pricing rotate | single routing config module; usage_log makes cost drift visible |
| LLM invents details | grounding rules + provenance links + gaps-not-fills are spec'd into every generation prompt and its UI |
| Anthropic auth/billing policy churn (subscription OAuth banned, Agent SDK terms whipsawed in 2026) | Console API key is the primary credential — stable terms; alternatives isolated behind the `AiTransport` seam ([auth.md](auth.md)) |
