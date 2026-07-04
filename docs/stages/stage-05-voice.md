# Stage 5 — Voice

Part of the [build plan](../build-plan.md) · Context to load: [voice](../architecture/voice.md) · [process-and-ipc](../architecture/process-and-ipc.md)

Goal: speak your answers; the interviewer can speak its questions.

- [ ] 5.1 Push-to-talk answer input: hold-to-record UI with level meter → whisper transcription → editable transcript → send as turn. Model download/manage UX (size, progress, re-download).
- [ ] 5.2 TTS toggle: interviewer questions via OS `speechSynthesis`.
- [ ] 5.3 *(stretch — deferrable)* Streaming upgrade: chunked PCM + VAD; live partial transcript while speaking; auto end-of-utterance turn-taking (keep push-to-talk as fallback mode).
- [ ] 5.4 Latency/accuracy pass on target hardware; pick default model size (`base.en` vs `small.en`); document the ladder.

**Checkpoint 5a (core)**: complete a full mock interview via push-to-talk — speak every answer, transcripts faithful and editable before send. This is the concept's headline experience working.

**Checkpoint 5b (stretch)**: streaming mode — live partial transcripts, turn-taking not annoying.
