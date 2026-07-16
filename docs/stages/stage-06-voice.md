# Stage 6 — Voice (push-to-talk core)

Part of the [build plan](../build-plan.md) · Context to load: [voice](../architecture/voice.md) · [process-and-ipc](../architecture/process-and-ipc.md)

Goal: speak your answers; the interviewer can speak its questions. Push-to-talk only — the hold-to-record button is the voice-activity detector and the endpointer, so this stage ships voice without solving streaming ASR. Streaming (live partials + auto turn-taking) is its own spike-gated stage: [Stage 6b](stage-06b-streaming-voice.md). Built on the Stage 1 design system: composes existing primitives, ships each screen's empty/loading/error/keyboard states, and honors the a11y + reduced-motion floor.

- [x] 6.1 Push-to-talk answer input: hold-to-record UI with level meter → whisper transcription → editable transcript → send as turn. Model download/manage UX (size, progress, re-download). Guard against whisper's silence-hallucination (empty/near-silent audio → "Thank you." / "Subtitles by…"): drop recordings under a min-duration and below an energy floor before transcription.
- [x] 6.2 TTS toggle: interviewer questions via OS `speechSynthesis`.
- [ ] 6.3 *(stretch — deferred to Stage 6b)* Streaming upgrade: chunked PCM + VAD; live partial transcript while speaking; auto end-of-utterance turn-taking (keep push-to-talk as fallback mode).
- [x] 6.4 Latency/accuracy pass on target hardware; pick default model size (`base.en` vs `small.en`); document the ladder. (Batch-decode budget only; sustained-streaming budget is Stage 6b.)

**Model ladder (6.4):** default is **`base.en`** (142 MB) — the balanced choice for push-to-talk answers. The manager offers `tiny.en` (75 MB, fastest/least accurate) and `small.en` (466 MB, most accurate/slowest); all run locally, no audio leaves the machine. The on-hardware latency/accuracy pass is part of the manual voice checkpoint (needs a real mic + packaged build). This ladder is the **batch-decode** budget; the sustained-streaming budget (chunk latency, decode cadence, per-tier RTF ceilings) lives in [Stage 6b's streaming budget](stage-06b-streaming-voice.md).

**Checkpoint 6 (core)**: complete a full mock interview via push-to-talk — speak every answer, transcripts faithful and editable before send. This is the concept's headline experience working.
