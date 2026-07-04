# Stage 0 — Walking skeleton & risk spikes

Part of the [build plan](../build-plan.md) · Context to load: [overview](../architecture/overview.md) · [process-and-ipc](../architecture/process-and-ipc.md) · [ai-layer](../architecture/ai-layer.md) · [retrieval](../architecture/retrieval.md) · [voice](../architecture/voice.md) *(the spikes touch everything)*

Goal: a packaged Windows app that proves every risky integration before features exist.

- [ ] 0.1 Scaffold electron-vite + React + TS + Tailwind; typed zod-validated IPC bridge skeleton; ESLint/Prettier; vitest + Playwright-for-Electron harness; GitHub Actions CI on `windows-latest`.
- [ ] 0.2 SQLite spike: better-sqlite3 + sqlite-vec extension + FTS5 loading **inside the packaged app** (ASAR-unpack config); migration runner v1 (backs up the DB file before applying any migration); CI packaged-app smoke test.
- [ ] 0.3 LLM spike: settings page storing an Anthropic key via safeStorage; one streamed Haiku call from main rendered token-by-token in the UI; usage row logged.
- [ ] 0.4 Voice spike: mic permission + AudioWorklet PCM capture in the packaged app; transcribe a 10-second clip with `smart-whisper` **in a utilityProcess worker** (fallbacks per spec if it fights); record real-time factor on target hardware; CI gets a transcribe-from-WAV-fixture test (covers model load + native binding without audio hardware).
- [ ] 0.5 Embedding spike: transformers.js bge-small model download to `userData` + embed a sentence + KNN round-trip through sqlite-vec, inference in a worker.

**Checkpoint 0**: packaged `.exe` on Windows: stores a key, streams a Claude reply, records and transcribes speech, embeds and vector-searches — all four spikes green, **and the UI stays responsive during transcription and embedding**. *Anything failing here changes the architecture while it's still cheap.*
