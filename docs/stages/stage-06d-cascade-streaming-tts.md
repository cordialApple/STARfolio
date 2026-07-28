# Stage 6d — Cascade streaming TTS (Stage B, planned)

Part of the [build plan](../build-plan.md) · Context to load: [full-duplex-migration](../architecture/full-duplex-migration.md) · [voice](../architecture/voice.md) · [ai-layer](../architecture/ai-layer.md) · [process-and-ipc](../architecture/process-and-ipc.md)

Goal: the Unmute-style cascade — Stage B of the [full-duplex migration](../architecture/full-duplex-migration.md) (see it for the Stage-B diagram and the B-vs-C ledger). A parallel branch after [Stage 6c](stage-06c-streaming-stt-swap.md): streaming STT is already in place, this stage adds **streaming TTS** and wires the loop end-to-end while keeping the tiered LLM brain **verbatim** — Opus roadmap, Sonnet rubric scoring, deterministic reducer, Haiku phrasing all drop in unchanged, exactly as Unmute proves the text LLM is a swappable module. **0% reasoning loss**: every tier stays live, on the hot path, fully auditable. Per the ledger this is the safe capture of ~90% of the perceived win. Nothing here is built yet.

The explicit ceiling, stated up front: the cascade is **still half-duplex at the reasoning boundary**. The LLM fires on the semantic end-of-turn and the user waits while the tiers think — **no barge-in, no overlap**. That is [Stage 6e](stage-06e-native-full-duplex.md)'s territory, and this stage does not attempt it.

## Framing — cascade is the flagship, not a stepping-stone

This is a **local desktop app on candidate hardware**. GPU-less laptops are the *majority* install base **permanently** — that's the entry-level job-seeker. So the cascade is not a throwaway bridge to Moshi; it is the **primary product tier**, and Moshi/full-duplex ([6e](stage-06e-native-full-duplex.md)) is an optional realism layer gated on a GPU. Consequence for this stage: **6d earns full polish + hardening**, not minimum-viable. See the [migration doc](../architecture/full-duplex-migration.md) — "Capability tiers, not a migration" + the cost/benefit ledger.

## Design — the intent seam (6d.2)

The naive turn loop draws the mouth-swap seam at *utterances* (`reducer → InterviewAction → phraser → speak()`, where the action IS the line Haiku speaks). That seam is too low: Moshi is **not** a phraser you can hand a line to, and full-duplex forks the reducer contract (a *prescriptive* line realized verbatim at a turn boundary vs. a *best-effort intent* injected as conditioning and fired in a gap). If we bake the utterance seam now, Stage C secretly forks the brain.

So 6d.2 draws the seam at **intents, not utterances**, and pays the cheap, GPU-free half of the Stage-C de-risk *inside Stage B*:

- **Above the line (shared, mouth-agnostic, invariant B→C):** Opus roadmap; the **canonical transcript store** (time-aligned, both speakers, overlap + truncation markers); Sonnet scoring over that store; the reducer emitting `InterviewAction` as an **intent + authority level** ("probe error handling" / "advance to topic 3", command-vs-steer), not a literal string; the final evaluation report.
- **Below the line (per-mouth):** turn/segment detection; *when* an intent is realized; phrasing (Haiku in B, Moshi's own generation in C); barge-in policy; audio transport.
- Cascade is the **degenerate case**: intent realized verbatim by Haiku, always honored, at the turn boundary.

- [~] 6d.1 Streaming TTS adapter: injectable streaming-TTS adapter under `app/src/main/voice/kyutai/tts/` — pure mirror of the STT spike (protocol/codec/config/adapter/stub/factory), reusing `SttTransport`/`FakeTransport`/`WebSocketTransport` verbatim. Ordering/gating invariants proved via pbt-in-ci (fast-check): codec round-trip/reject + adapter audio-order/start-once/marker-mirror/error-forward/pending-flush. **Deferred (GPU-blocked):** the real local moshi TTS server + on-wire byte format — the stub transport stands in; the wire protocol here is modelled, not confirmed against a running server.
- [x] 6d.2a Intent `InterviewAction`: redraw the reducer output as **intent + authority level** (not a literal spoken line). Cascade phraser (Haiku) realizes the intent verbatim at the turn boundary — the degenerate, always-honored case. Keeps the brain's output type identical whether the mouth is Haiku or Moshi.
- [x] 6d.2b Canonical transcript store: mouth-agnostic, time-aligned, both speakers, with **overlap + truncation markers** (trivially empty under the cascade's clean turns). Sonnet scores over *this*, not a raw per-turn string — so the scorer's input shape already tolerates duplex.
- [x] 6d.2c Seam conformance suite (pbt-in-ci): one property suite both mouths must pass — same intent sequence in → verify the realization guarantees out. Locks the above/below line so B and C can't drift into two half-products.
- [x] 6d.2d Sonnet-survives-duplex tests (pbt-in-ci, CPU): property tests scoring **synthetic truncated / overlapped transcripts** — prove the rubric brain holds rigor on duplex-shaped input *now*, on CPU, before any GPU exists. Cheapest available de-risk of the whole Stage-C bet.
- [x] 6d.2e Turn loop: the tiers fire on the semantic end-of-turn from 6c's STT; Haiku's phrased line streams straight into TTS; the half-duplex gate around playback holds (no self-transcribed interviewer).
- [ ] 6d.3 Retire the TTFT-guard / stall-watchdog scaffolding — it papered over turn-buffered output, and genuinely streamed audio replaces it.
- [ ] 6d.4 On-hardware sustained pass: full spoken interview, streaming both directions; measure end-of-speech → first-audio latency (STT 500 ms + tier round-trips + TTS start, per the ledger) and document it.

**Checkpoint 6d**: a full spoken mock interview that streams both ways — you speak, it answers in streamed audio, fast and natural — with the tiered brain untouched and every score still auditable. Explicitly still turn-gated: interrupting the interviewer does nothing, by design.
