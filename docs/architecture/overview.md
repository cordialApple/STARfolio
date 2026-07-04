# Architecture — Overview & Stack

Part of the [architecture spec](../architecture.md) · requirements: [concept](../starfolio-concept.md)

## Context

STARfolio is a private, single-user desktop app: a longitudinal bank of accomplishments in STAR form (Situation/Task/Action/Result), with an LLM assistant that (A) runs live mock interviews with feedback and drill-down follow-ups, and (B) generates polished on-demand STAR stories from the bank. Fixed constraints from the concept doc: local desktop app, no account, no server.

Locked decisions:

- **LLM**: cloud API (Anthropic) with a user-supplied key stored in the OS credential store; the app itself stays serverless and account-free.
- **Voice**: core to live practice — de-risked from day one, built right after the MVP bank works.
- **Platform**: Windows first; cross-platform capable.
- **Knowledge layer**: a graph *model* inside SQLite (typed joins + generic entities/edges), not a graph *engine* — rationale in [data-model.md](data-model.md).

Two research sweeps (desktop shell + data layer; AI/ingestion/voice pipeline, July 2026 sources) inform every stack choice below.

## Stack decision & rationale

**Electron + TypeScript end-to-end.** Tauri v2 was the close runner-up (smaller binaries, statically-linked sqlite-vec), but three findings flip it for *this* app:

1. **Voice is core.** Chromium's `getUserMedia` + `session.setPermissionRequestHandler` are mature; Windows WebView2 has buffered/dropping streaming responses and a mic-permission prompt that, once blocked, cannot be re-requested via any API (Tauri #5042/#12547). Building a core feature on that is the wrong risk.
2. **Ingestion breadth is a core pillar.** The hard formats all have their best libraries in Node: `pdfjs-dist` (PDF), `mammoth` (DOCX), `@mozilla/readability` (URLs), `repomix` as an MIT library (repo→LLM-ready text). Rust's decisive wins (calamine, fastembed-rs) have acceptable Node equivalents (`exceljs`, `transformers.js`).
3. **Solo velocity**: one language across main/renderer/tests; the ~150 MB footprint is irrelevant for a personal single-user app.

The accepted tax: packaging native modules (`better-sqlite3` + the `sqlite-vec` loadable extension) through ASAR — a known, bounded problem (prebuilt binaries exist on npm: `sqlite-vec`, `@photostructure/sqlite-vec`), solved once in Stage 0 and verified in CI thereafter.

| Concern | Choice | Notes |
|---|---|---|
| Shell | **Electron** (electron-vite scaffold) | main = backend, renderer = UI, typed IPC via contextBridge |
| UI | **React + TypeScript + Tailwind** | Vite dev server; no meta-framework needed |
| Store | **SQLite, single file** in `userData` | `better-sqlite3`; migrations table; the DB file *is* the backup unit |
| Keyword search | **FTS5** (bundled in better-sqlite3) | BM25 |
| Vector search | **sqlite-vec** (loadable ext., pinned — pre-1.0) | brute-force KNN is ample at personal scale (≤ tens of thousands of rows) |
| Embeddings | **transformers.js v4 + bge-small-en-v1.5 (quantized, ~34 MB)** | downloaded once to `userData`, fully offline after; cloud embeddings deliberately excluded (Anthropic has no embeddings API; a second vendor key isn't worth it) |
| LLM | **Anthropic API from the main process** (`@anthropic-ai/sdk`) | Sonnet for interviewing/story generation, Haiku for extraction; structured outputs via `messages.parse()` + zod; prompt caching on stable system prompts; streamed to renderer over IPC events |
| API key | **Electron `safeStorage`** (DPAPI on Windows) | never enters the renderer; `keytar` is dead — not used |
| STT (voice) | **whisper.cpp** — `smart-whisper` binding, sidecar-binary fallback | `base.en`/`small.en`; push-to-talk batch first, streaming as an upgrade |
| TTS (optional) | OS `speechSynthesis` | zero dependency; piper only if voice quality ever matters (it's GPL-3 now) |
| Packaging | **electron-builder** → NSIS, Windows-first | unsigned initially (SmartScreen warning accepted for personal use); electron-updater + GitHub Releases in the final stage |
| Tests / CI | vitest (services, temp-file SQLite), Playwright-for-Electron smoke e2e, GitHub Actions `windows-latest` | packaged-app smoke test in CI catches native-module regressions |
