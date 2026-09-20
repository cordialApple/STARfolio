# Stage 6d — Cascade streaming TTS (Stage B, in progress)

Part of the [build plan](../build-plan.md) · Context to load: [full-duplex-migration](../architecture/full-duplex-migration.md) · [voice](../architecture/voice.md) · [ai-layer](../architecture/ai-layer.md) · [process-and-ipc](../architecture/process-and-ipc.md)

Goal: the Unmute-style cascade — Stage B of the [full-duplex migration](../architecture/full-duplex-migration.md). The streaming TTS adapter, intent seam, canonical transcript, conformance properties, scorer fixtures, and turn loop are built. The real service wire, watchdog cleanup, compute target, and sustained pass remain open.

The explicit ceiling, stated up front: the cascade is **still half-duplex at the reasoning boundary**. The LLM fires on the semantic end-of-turn and the user waits while the tiers think — **no barge-in, no overlap**. That is [Stage 6e](stage-06e-native-full-duplex.md)'s territory, and this stage does not attempt it.

## Framing — cascade is the flagship, not a stepping-stone

STARfolio runs on a normal local machine. The cascade is not a throwaway bridge to Moshi; it is the auditable assessment path. Moshi/full duplex ([6e](stage-06e-native-full-duplex.md)) is an optional realism layer backed by temporary remote GPU compute. Stage 6d still earns full polish and hardening because its exact spoken text remains easier to audit.

## Design — the intent seam (6d.2)

The naive turn loop draws the mouth-swap seam at *utterances* (`reducer → InterviewAction → phraser → speak()`, where the action IS the line Haiku speaks). That seam is too low: Moshi is **not** a phraser you can hand a line to, and full-duplex forks the reducer contract (a *prescriptive* line realized verbatim at a turn boundary vs. a *best-effort intent* injected as conditioning and fired in a gap). If we bake the utterance seam now, Stage C secretly forks the brain.

So 6d.2 draws the seam at **intents, not utterances**, and pays the cheap, GPU-free half of the Stage-C de-risk *inside Stage B*:

- **Above the line (shared, mouth-agnostic, invariant B→C):** Opus roadmap; the **canonical transcript store** (time-aligned, both speakers, overlap + truncation markers); Sonnet scoring over that store; the reducer emitting `InterviewAction` as an **intent + authority level** ("probe error handling" / "advance to topic 3", command-vs-steer), not a literal string; the final evaluation report.
- **Below the line (per-mouth):** turn/segment detection; *when* an intent is realized; phrasing (Haiku in B, Moshi's own generation in C); barge-in policy; audio transport.
- Cascade is the **degenerate case**: intent realized verbatim by Haiku, always honored, at the turn boundary.

- [~] 6d.1 Streaming TTS adapter: protocol, codec, config, adapter, stub, factory, and ordering properties are built. The real service and wire format remain unverified. No runtime compute target is selected.
- [x] 6d.2a Intent `InterviewAction`: redraw the reducer output as **intent + authority level** (not a literal spoken line). Cascade phraser (Haiku) realizes the intent verbatim at the turn boundary — the degenerate, always-honored case. Keeps the brain's output type identical whether the mouth is Haiku or Moshi.
- [x] 6d.2b Canonical transcript store: mouth-agnostic, time-aligned, both speakers, with **overlap + truncation markers** (trivially empty under the cascade's clean turns). Sonnet scores over *this*, not a raw per-turn string — so the scorer's input shape already tolerates duplex.
- [x] 6d.2c Seam conformance suite (pbt-in-ci): one property suite both mouths must pass — same intent sequence in → verify the realization guarantees out. Locks the above/below line so B and C can't drift into two half-products.
- [x] 6d.2d Deterministic scoring-contract properties: synthetic truncated and overlapped transcripts exercise input shaping, totality, invariance, and score ranges. They do not test Sonnet or prove provider rigor.
- [x] 6d.2e Turn loop: the tiers fire on the semantic end-of-turn from 6c's STT; Haiku's phrased line streams straight into TTS; the half-duplex gate around playback holds (no self-transcribed interviewer).
- [ ] 6d.3 Retire the TTFT-guard / stall-watchdog scaffolding — it papered over turn-buffered output, and genuinely streamed audio replaces it.
- [ ] 6d.4 On-hardware sustained pass: full spoken interview, streaming both directions; measure end-of-speech → first-audio latency (STT 500 ms + tier round-trips + TTS start, per the ledger) and document it.

**Checkpoint 6d**: run a full spoken mock interview against the selected real services, measure both directions, and verify the tiered role contract and auditable scores survive. It remains turn-gated by design.
