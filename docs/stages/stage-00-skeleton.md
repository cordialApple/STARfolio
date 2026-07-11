# Stage 0 — Walking skeleton & risk spikes

Part of the [build plan](../build-plan.md) · Context to load: [overview](../architecture/overview.md) · [process-and-ipc](../architecture/process-and-ipc.md) · [ai-layer](../architecture/ai-layer.md) · [retrieval](../architecture/retrieval.md) · [voice](../architecture/voice.md) *(the spikes touch everything)*

Goal: a packaged Windows app that proves every risky integration before features exist.

- [x] 0.1 Scaffold electron-vite + React + TS + Tailwind; typed zod-validated IPC bridge skeleton; ESLint/Prettier; vitest + Playwright-for-Electron harness; GitHub Actions CI on `windows-latest` running **lint + typecheck + unit + build:unpack + e2e** (lint must be a gating step, not optional).
- [x] 0.2 SQLite spike: better-sqlite3 + sqlite-vec extension + FTS5 loading **inside the packaged app** (ASAR-unpack config); migration runner v1 (backs up the DB file before applying any migration); CI packaged-app smoke test.
- [x] 0.3 LLM spike: settings page storing an Anthropic key via safeStorage; one streamed Haiku call from main rendered token-by-token in the UI; usage row logged.
- [x] 0.4 Voice spike: mic permission + AudioWorklet PCM capture in the packaged app; transcribe a 10-second clip with `smart-whisper` **in a utilityProcess worker** (fallbacks per spec if it fights); record real-time factor on target hardware; CI gets a transcribe-from-WAV-fixture test (covers model load + native binding without audio hardware).
- [x] 0.5 Embedding spike: transformers.js bge-small model download to `userData` + embed a sentence + KNN round-trip through sqlite-vec, inference in a worker.
- [x] 0.6 Release CD: a `release.yml` workflow that on a `v*` tag runs `build:win` and publishes a GitHub Release with the NSIS installer, the blockmap, and `latest.yml` (the electron-updater feed) as assets; version derived from the tag; job runs on `windows-latest`. Document the tag-to-release flow in the repo README. *(Auto-update wiring is deferred to Stage 11; this stage just produces a downloadable, updater-ready release.)*

**Checkpoint 0**: packaged `.exe` on Windows: stores a key, streams a Claude reply, records and transcribes speech, embeds and vector-searches — all four spikes green, **and the UI stays responsive during transcription and embedding**; CI runs lint+typecheck+unit+build+e2e and is green; a tagged build produces a downloadable GitHub Release with installer + `latest.yml`. *Anything failing here changes the architecture while it's still cheap.*
