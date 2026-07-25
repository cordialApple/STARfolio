# Stage 6d — Cascade streaming TTS (Stage B, planned)

Part of the [build plan](../build-plan.md) · Context to load: [full-duplex-migration](../architecture/full-duplex-migration.md) · [voice](../architecture/voice.md) · [ai-layer](../architecture/ai-layer.md) · [process-and-ipc](../architecture/process-and-ipc.md)

Goal: the Unmute-style cascade — Stage B of the [full-duplex migration](../architecture/full-duplex-migration.md) (see it for the Stage-B diagram and the B-vs-C ledger). A parallel branch after [Stage 6c](stage-06c-streaming-stt-swap.md): streaming STT is already in place, this stage adds **streaming TTS** and wires the loop end-to-end while keeping the tiered LLM brain **verbatim** — Opus roadmap, Sonnet rubric scoring, deterministic reducer, Haiku phrasing all drop in unchanged, exactly as Unmute proves the text LLM is a swappable module. **0% reasoning loss**: every tier stays live, on the hot path, fully auditable. Per the ledger this is the safe capture of ~90% of the perceived win. Nothing here is built yet.

The explicit ceiling, stated up front: the cascade is **still half-duplex at the reasoning boundary**. The LLM fires on the semantic end-of-turn and the user waits while the tiers think — **no barge-in, no overlap**. That is [Stage 6e](stage-06e-native-full-duplex.md)'s territory, and this stage does not attempt it.

- [ ] 6d.1 Streaming TTS: local TTS server + adapter for the interviewer's voice in interview mode, replacing turn-buffered playback with genuinely streamed audio.
- [ ] 6d.2 Turn loop: the tiers fire on the semantic end-of-turn from 6c's STT; Haiku's phrased line streams straight into TTS; the half-duplex gate around playback holds (no self-transcribed interviewer).
- [ ] 6d.3 Retire the TTFT-guard / stall-watchdog scaffolding — it papered over turn-buffered output, and genuinely streamed audio replaces it.
- [ ] 6d.4 On-hardware sustained pass: full spoken interview, streaming both directions; measure end-of-speech → first-audio latency (STT 500 ms + tier round-trips + TTS start, per the ledger) and document it.

**Checkpoint 6d**: a full spoken mock interview that streams both ways — you speak, it answers in streamed audio, fast and natural — with the tiered brain untouched and every score still auditable. Explicitly still turn-gated: interrupting the interviewer does nothing, by design.
