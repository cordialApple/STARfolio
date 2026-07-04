# Architecture — Voice (mode A)

Part of the [architecture spec](../architecture.md) · threading: [process-and-ipc.md](process-and-ipc.md)

- **v1 — push-to-talk**: renderer captures mic (`getUserMedia` + AudioWorklet, 16 kHz mono PCM) while held; on release, PCM goes over IPC to main; whisper.cpp (`smart-whisper`, `base.en`/`small.en`, model downloaded on first use) transcribes the utterance; transcript becomes the user's turn, editable before send. This ships voice without solving streaming.
- **v2 — streaming**: chunked PCM + VAD for live partial transcripts and auto turn-taking.
- **Explicitly rejected**: Web Speech API recognition (routes audio to Google/Azure — breaks the privacy promise). TTS for the interviewer's questions is a toggle on OS `speechSynthesis`.
- **Fallback ladder** if `smart-whisper` fights the Electron ABI: (1) spawn whisper.cpp as a bundled sidecar binary; (2) `nodejs-whisper` CLI wrapper. The Stage-0 spike picks the winner before anything depends on it.
