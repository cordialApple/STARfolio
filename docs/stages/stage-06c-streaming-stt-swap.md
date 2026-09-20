# Stage 6c — Streaming-STT swap (Stage A, in progress)

Part of the [build plan](../build-plan.md) · Context to load: [full-duplex-migration](../architecture/full-duplex-migration.md) · [voice](../architecture/voice.md) · [process-and-ipc](../architecture/process-and-ipc.md) · [ai-layer](../architecture/ai-layer.md)

Goal: swap the ASR front end — replace [Stage 6b](stage-06b-streaming-voice.md)'s whisper-era faked streaming with Kyutai STT behind `app/src/main/voice/`. The adapter, session wiring, and obsolete streaming-module deletion have landed. The real runtime protocol, endpoint quality, and sustained microphone pass remain unverified.

Why its own stage: the modelled wire proves the local contracts, not a live service. No runtime compute target is selected for this stage. The normal STARfolio machine is not assumed to have a GPU, and this stage does not inherit the Stage 6e AWS worker by implication.

- [~] 6c.1 Live spike: select a compute target, stand up Kyutai STT, verify the real wire, and compare semantic endpointing with the whisper baseline.
- [~] 6c.2 Adapter/service: codec, protocol, config, factory, stub, and tests are built; live service compatibility is open. `stableUpTo` means all committed tokens.
- [x] 6c.3 Wire behind the seam: renderer capture feeds `KyutaiVoiceSession`; `RollingTranscript`, IPC, and the tiered brain consume it unchanged.
- [x] 6c.4 Retire the six whisper-era streaming modules. Push-to-talk batch whisper remains.
- [ ] 6c.5 On-hardware sustained pass: real mic + packaged build, full-length session; confirm endpoint latency ~500 ms (vs 1.28 s), no mid-thought cut-offs, sustained real-time behavior; document the new budget, superseding [6b's streaming budget](stage-06b-streaming-voice.md#streaming-budget-6b5).

**Checkpoint 6c**: a hands-free mock interview against the real service, with committed partials, clean semantic turns, and no mid-thought cutoffs. The compute target and data boundary must be explicit before this work resumes.
