# Architecture — Process & IPC

Part of the [architecture spec](../architecture.md)

## Process & module layout

```
main process (all privileged work)
├── db/           migrations, repositories (experiences, skills, sources, corpus, sessions)
├── search/       hybrid retrieval: FTS5 BM25 + sqlite-vec KNN → reciprocal-rank fusion; SQL filters
├── embed/        transformers.js pipeline; embed-on-write queue; model download/manage
├── ai/           Anthropic client, model routing, zod-schema structured calls, prompt cache
│                 config, streaming, usage/cost logging
├── ingest/       Extractor per input kind → ExtractedSource → STAR proposer → gap questions
├── voice/        PCM intake from renderer, whisper.cpp transcription, VAD/utterance events
├── ipc/          one typed, zod-validated contextBridge API; streaming via request-id events
└── settings/     safeStorage-wrapped secrets, preferences

renderer (React) — pure UI, no secrets, no direct network/LLM access
├── Bank        browse/filter (skill, context, date), keyword + NL search
├── Capture     guided STAR form (drafts) · brain dump · file/URL/repo import wizard
├── Practice    interview chat (text + voice), live feedback, session history
├── Generate    genre/JD/discipline → story; saved stories with source-experience links
└── Settings    API key, model prefs, voice, nudges, export
```

Renderer never sees the API key and never calls the network for AI — every LLM/embedding/ingest operation is an IPC call into main. This is both the security boundary and what keeps CORS/streaming trivial.

## Execution model

Whisper transcription and embedding inference run in Electron `utilityProcess` (or `worker_threads`) workers — never on the main thread, which handles only IPC and short synchronous SQLite calls. A 60-second transcription or an embedding backfill must not freeze the window; this is proven in the Stage-0 spikes, not discovered in Stage 5. Every streamed IPC operation (story generation, interviewer replies) is cancellable: an abort-by-request-id message feeds an `AbortSignal` into the Anthropic SDK call.
