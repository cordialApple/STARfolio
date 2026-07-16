# Stage 6b — Streaming voice (deferrable)

Part of the [build plan](../build-plan.md) · Context to load: [voice](../architecture/voice.md) · [process-and-ipc](../architecture/process-and-ipc.md)

Goal: upgrade [Stage 6](stage-06-voice.md)'s push-to-talk to hands-free — live partial transcripts while you speak, auto end-of-utterance turn-taking. Push-to-talk stays as a fallback mode; nothing here is on the MVP path, so this stage floats freely after Stage 6 (can land after Stages 7–8). Built on the Stage 1 design system: composes existing primitives, ships each screen's empty/loading/error/keyboard states, and honors the a11y + reduced-motion floor.

Why its own stage: "chunked PCM + VAD" hides five subsystems whisper's batch model does not give for free. Whisper is not a streaming model — live partials mean sliding-window re-decode with local-agreement stabilization, and partials get *revised*, which the IPC contract and UI must model. This stage front-loads a spike, exactly like Stage 0 did for the batch risks, before any feature work.

- [ ] 6b.1 **Spike (gate — do first):** pick the VAD (Silero ONNX vs WebRTC VAD vs energy/RMS) and prove it endpoints interview-style speech with long thinking pauses without cutting the speaker off mid-answer; prove a streaming-decode strategy (sliding window + local-agreement, or chunk+revise) holds sustained real-time factor < 1.0 on target hardware; prove half-duplex (mute capture while `speechSynthesis` is speaking) kills TTS→mic echo so the interviewer doesn't transcribe its own question. Anything failing here reshapes the stage while it's cheap.
- [ ] 6b.2 Audio front-end: continuous 16 kHz mono frames renderer → voice worker; ring buffer + backpressure policy when decode falls behind real-time; VAD emits `utteranceStart`/`utteranceEnd`.
- [ ] 6b.3 Live partial transcript: revisable partial-transcript events (`{ text, stableUpTo }`) rendered as the user speaks; endpointer finalizes the turn; VAD gates whisper input so silence never reaches the decoder (no human edit gate here — this replaces the Stage 6 min-duration/energy guard).
- [ ] 6b.4 Auto turn-taking: on end-of-utterance, send the turn to the interviewer engine; half-duplex handoff around TTS playback; push-to-talk remains selectable as fallback.
- [x] 6b.5 Sustained-streaming latency/accuracy pass on target hardware; document the chunk-latency and RTF budget alongside the Stage 6 model ladder.

**Streaming budget (6b.5):** streaming re-decodes a growing window on a cadence and stabilizes downstream, so the budget is set by that loop, not by one batch decode. Config-derived (`streaming/vad.ts`, `streaming/window.ts`):

- **Decode cadence:** re-decode after each ~**1 s** of fresh audio (`decodeIntervalSamples = 16 kHz`); window is capped at **30 s** so per-decode cost stays bounded.
- **Chunk latency** (spoke → partial reflects it): decode cadence + one decode = `interval × (1 + RTF)`. Ceiling **2000 ms** to still feel live.
- **Endpoint finalization:** **~1.28 s** of silence ends a turn (`hangoverFrames 40 × 32 ms`) — generous so a mid-answer pause never cuts the speaker off.
- **RTF ceiling** (hard, sustained): `worstRtf < 1.0` or decode falls behind real-time. Per-tier headroom targets: `tiny.en` ≤ 0.5, `base.en` ≤ 0.7 (streaming default), `small.en` ≤ 0.95 (near the ceiling — only sustains on faster target hardware, so not the streaming default).

These are codified in `streaming/budget.ts` (`STREAM_BUDGETS`, `withinBudget`, `projectedChunkLatencyMs`) and asserted by the `RtfMeter` decode-loop tests. The real on-hardware sustained pass (real mic + packaged build) stays part of the manual voice checkpoint, same as the 6.4 batch pass.

**Checkpoint 6b**: a hands-free mock interview — live partial transcripts, turn-taking that isn't annoying (no mid-answer cut-offs, no self-transcribed TTS), push-to-talk still available as fallback.
