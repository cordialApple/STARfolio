# Stage 6 — Voice

Part of the [build plan](../build-plan.md) · Context to load: [voice](../architecture/voice.md) · [process-and-ipc](../architecture/process-and-ipc.md)

Goal: speak your answers; the interviewer can speak its questions. Built on the Stage 1 design system: composes existing primitives, ships each screen's empty/loading/error/keyboard states, and honors the a11y + reduced-motion floor.

- [ ] 6.1 Push-to-talk answer input: hold-to-record UI with level meter → whisper transcription → editable transcript → send as turn. Model download/manage UX (size, progress, re-download).
- [ ] 6.2 TTS toggle: interviewer questions via OS `speechSynthesis`.
- [ ] 6.3 *(stretch — deferrable)* Streaming upgrade: chunked PCM + VAD; live partial transcript while speaking; auto end-of-utterance turn-taking (keep push-to-talk as fallback mode).
- [ ] 6.4 Latency/accuracy pass on target hardware; pick default model size (`base.en` vs `small.en`); document the ladder.

**Checkpoint 6a (core)**: complete a full mock interview via push-to-talk — speak every answer, transcripts faithful and editable before send. This is the concept's headline experience working.

**Checkpoint 6b (stretch)**: streaming mode — live partial transcripts, turn-taking not annoying.
