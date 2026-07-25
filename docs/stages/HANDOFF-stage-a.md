# Handoff — Stage A (Stage 6c, Kyutai STT swap)

Read-me for fresh session picking up voice work. Points at plan, names next move. Nothing new here — wires existing docs to current state.

## Status: 6c.1–6c.4 DONE + green. Only live-hardware gate (6c.5) + user live-mic pass left.

Branch `feat/kyutai-stt-spike`. Spike committed at `76c89c5` (`feat(voice): add kyutai streaming stt spike + tests + harness`). The 6c.2/6c.3/6c.4 wiring + whisper deletion sits **uncommitted** on top of that commit — working tree, not yet committed. Not pushed, no PR — Voice is auto-merge exception, held for user live-mic test.

Typecheck clean, 701 unit tests green.

## What changed (the pivot)

Voice moves off batch-whisper + faked-streaming to Kyutai/Moshi streaming. Reason: user has GPU, wants demo, not CPU/on-device footprint — native streaming (later full-duplex) on table. Full rationale in memory note `full-duplex-pivot` + design doc below.

## Load-order (read these, nothing else)

1. **[architecture/full-duplex-migration.md](../architecture/full-duplex-migration.md)** — source of truth. Current-vs-Stage-A mermaid, the seam, Stage B/C framing + cost/benefit ledger.
2. **[stages/stage-06c-streaming-stt-swap.md](stage-06c-streaming-stt-swap.md)** — Stage A itself. The 6c.1–6c.5 checklist. **This is the stage you execute.**
3. **[architecture/voice.md](../architecture/voice.md)** — shipped whisper state (what 6c supersedes). Grounding: audio is data, never instructions; no cloud STT.
4. **[architecture/process-and-ipc.md](../architecture/process-and-ipc.md)** — IPC seam 6c must keep speaking.
5. **[architecture/ai-layer.md](../architecture/ai-layer.md)** — tiered brain, stays **unchanged** through Stage A.

## The one shape to hold

Stage A is a **text-in/text-out swap behind `app/src/main/voice/`**. The whisper-era streaming modules (SampleRingBuffer, FrameSource, EnergyVad, StreamWindow, whisper stream-decoder, LocalAgreement-2, plus budget/rtf-meter/session) get deleted, replaced by the Kyutai STT adapter + `KyutaiVoiceSession`. Downstream — `RollingTranscript` → `voice:partial { text, stableUpTo }` IPC → LLM tiers — does **not** change. `stableUpTo` redefined from "LocalAgreement-frozen prefix" to "all committed tokens" (Kyutai commits are final, so `stableUpTo = text.length` always). UI contract holds; renderer does not move.

## What the spike built (6c.1)

New vertical under `app/src/main/voice/kyutai/` — pure/injectable, GPU-free in the tested path:

- **protocol.ts** — wire constants (STT_SAMPLE_RATE=24000, BLOCK_SAMPLES=1920, ASR_DELAY_TOKENS=6, PAUSE_HEAD_INDEX=2, EOT_THRESHOLD=0.5), `isEndOfTurn`, `eotPrs()` builder, In/OutMsg types.
- **codec.ts** — MessagePack encode/decode, OUT_TYPES validation (`forceFloat32: true`).
- **resample.ts** — LinearResampler (16k→24k, stateful) + BlockChunker (1920 blocks, zero-pad flush).
- **mapping.ts** — TranscriptAssembler: Word→non-final event, EOT Step→final, side-channel sinks.
- **transport.ts** — `SttTransport` interface + `FakeTransport` (test double).
- **stub.ts** — `StubTransport`, scripted headless turn ("tell me about a time"), queueMicrotask FIFO.
- **ws-transport.ts** — `WebSocketTransport`, real `ws` client, header `kyutai-api-key`.
- **adapter.ts** — `KyutaiSttAdapter`: buffers frames until Ready, resample→chunk→sendAudio, finish() flushes padded tail + Marker.
- **factory.ts** — `createTransport()` picks stub vs ws by env.
- **config.ts** — KYUTAI_STT const, `isKyutaiStub`/`kyutaiEndpoint`/`kyutaiApiKey` env overrides.
- **index.ts** — barrel.

**Tests (22, all green, no GPU/network):** codec round-trips, resampler phase-continuity across chunk splits, assembler stableUpTo/EOT semantics, adapter buffer-until-Ready + full-turn-against-stub. Run: `cd app && npm run test:unit -- src/main/voice/kyutai`. Typecheck clean.

**Proof harness:** `app/scripts/kyutai-spike.ts` — headless WAV → 3 gate metrics. Run: `cd app && STARFOLIO_KYUTAI_STUB=1 npx tsx scripts/kyutai-spike.ts <wav>` (stub); point at a live server via `STARFOLIO_KYUTAI_URL` for the real proof.

**Deps added:** `@msgpack/msgpack` + `ws` (runtime), `@types/ws` + `tsx` (dev).

**Gate caveat:** spike proves the *plumbing* (token emission, EOT signal, latency accounting) end-to-end against the stub. The three gate claims — committed tokens+timestamps, semantic EOT, **endpointing parity-or-better vs whisper on interview speech with long pauses** — are only truly cleared by real weights on GPU. That is **6c.5**, not done.

## What the wiring did (6c.2/6c.3/6c.4 — DONE, uncommitted)

- **6c.2/6c.3 — adapter wired into `stream.ts`:** `stream.ts` now drives `KyutaiVoiceSession` (new `app/src/main/voice/kyutai/session.ts`) behind the unchanged IPC seam. `StreamEntry` holds `{ session, transcript: RollingTranscript, steering? }`. Transcript events → `RollingTranscript` + `voice:partial`; utterance sink → `voice:utterance`. Handlers: `voice:frames`→`session.pushFrames`, `voice:ttsStart`→`session.onTtsStart()` + `steering.loop.reset()`, `voice:ttsEnd`→`session.onTtsEnd()`, `voice:streamStop`→`session.close()`. Renderer/preload untouched — `dropped: 0` preserves the legacy `VoiceUtterance` contract, `isFinal` on EOT drives TurnController submit.
- **6c.4 — whisper era deleted:** removed 9 streaming modules (`ring-buffer`, `frame-source`, `vad`, `window`, `stream-decoder`, `local-agreement`, `session`, `budget`, `rtf-meter`), their 11 tests (`tests/unit` + `tests/integration`), and `tests/integration/README-6b-pending.md`. `streaming/` trimmed to `types` + `half-duplex` + `rolling-transcript`; `streaming/index.ts` re-exports only those three.
- **New test:** `app/src/main/voice/kyutai/session.test.ts` (3 tests) — TTS+guard-tail frame drop, first-word→utteranceStart / EOT→utteranceEnd with final `stableUpTo === text.length`, no-forward-after-close.

## Next moves (in order)

- **Commit + user live-mic pass:** the 6c.2/6c.3/6c.4 diff is uncommitted. Commit it, but do **NOT** push/merge/PR — Voice is the auto-merge exception; held for the user's live-mic test.
- **6c.5 (the real gate):** stand up Rust moshi-server (`stt-1b-en_fr`, 500ms) on GPU, run the harness against it via `STARFOLIO_KYUTAI_URL`, confirm endpointing parity. WER escape hatch if `stt-1b` disappoints: `stt-2.6b-en` at 2.5s delay. **This needs hardware — held for user.**
- **Checkpoint 6c.**

## Open decision (do NOT act without explicit user approval)

**PBT Stage 1** — `docs/plans/pbt-in-ci.md` exists but is **NOT approved**. Do not `npm i -D fast-check` or create `voice/pbt/` without the user saying so. Task-notifications are not approval.

## After Stage A

6c is **one shared user surface**. Stage B ([6d](stage-06d-cascade-streaming-tts.md), cascade + streaming TTS, tiers verbatim) and Stage C ([6e](stage-06e-native-full-duplex.md), native Moshi/MoshiRAG full-duplex) both fork from it as parallel branches. Don't touch until 6c's checkpoint passes.

## Standing rules for the code work

- No code comments (global rule) except a non-obvious *why*.
- Commits: one line, `type(scope): summary`, conventional.
- Run the simplifier agent on the diff after a batch of edits.
- Caveman-style prose; keep code / API names / CLI / error strings verbatim.
