# Stage 6b integration seams — pending checklist

`voice-streaming-pipeline.test.ts` covers every composition that the **landed 6b.1 cores**
already support end-to-end at the module level (VAD turns, LocalAgreement stability,
HalfDuplex↔VAD gating, StreamWindow+RtfMeter decode loop). No real mic, no real whisper.

The seams below are **not testable yet** — the glue code does not exist. Each entry is a
checklist item for the 6b.2–6b.4 test threads: what is missing, why, and the exact
integration test to add once the slice lands. Do NOT fake these against stubs before the
code exists.

---

## 6b.2 — audio front-end (renderer → voice worker frame transport)

**Missing:** continuous 16 kHz mono frame channel from the renderer capture into a voice
worker. Today `src/main/voice/worker.ts` handles only a one-shot `{ type: 'transcribe', pcm }`
(the whole utterance at once) and `src/main/voice/index.ts` exposes a single batch
`transcribe(pcm)`. There is no streaming frame pump, no `utteranceStart`/`utteranceEnd`
wiring off the live stream.

**Test once landed:** feed a scripted PCM frame stream (silence→speech→pause→speech→silence)
into the front-end entry point and assert it emits the same `utteranceStart`/`utteranceEnd`
sequence the pure `EnergyVad` test asserts — proving the transport preserves frame order and
timing into the VAD.

## 6b.2 — ring buffer + backpressure

**Missing:** no ring-buffer module. Nothing bounds producer (renderer capture) vs consumer
(decode loop) rates or drops/coalesces under load.

**Test once landed:** push frames faster than the decode loop drains, assert the buffer caps
at its configured length (oldest dropped, newest kept — mirror `StreamWindow.trim`), assert a
drop/backpressure signal fires, and assert no unbounded growth. Then drain and assert the
consumer sees a contiguous recent tail.

## 6b.3 — live partial transcript `voice:partial` IPC events

**Missing:** the `voice:partial` channel does not exist. Preload/IPC today expose only
`voice:transcribe`, `voice:models`, `voice:downloadModel`, `voice:deleteModel`,
`voice:modelStatus`. There is no streaming decode loop that drives `LocalAgreement.update`
from repeated whisper passes over the growing `StreamWindow`.

**Test once landed:** run the decode loop against the whisper **stub** (`STARFOLIO_WHISPER_STUB=1`)
or a fake decoder that emits a scripted growing/revised hypothesis series, capture every
`voice:partial` payload, and assert each is `{ text, stableUpTo }` with `stableUpTo`
monotonic non-decreasing across the turn and `text.startsWith(stablePrefix)` — the locked
routing seam contract. This is the same invariant the pure `LocalAgreement` test asserts, but
across the real event boundary.

## 6b.3 — endpointer finalize + VAD-gated whisper input

**Missing:** nothing wires `EnergyVad` → `StreamWindow` → `transcribe`. Whisper is not gated
by VAD; the endpointer does not trigger a `finalize()` commit of the turn.

**Test once landed:** drive the composed VAD+window+decode path with a synthetic utterance,
assert whisper is invoked only while `vad.inUtterance` is true (silence frames do not decode),
and assert `utteranceEnd` produces exactly one finalized partial where `stableUpTo === text.length`.

## 6b.4 — turn dispatch to the interviewer engine

**Missing:** no code routes end-of-utterance to the interviewer engine. The turn-taking
handoff (finalized transcript → interviewer turn) is unbuilt.

**Test once landed:** on `utteranceEnd`, assert the finalized transcript is dispatched exactly
once to a mock interviewer engine with the final text, and that a new utterance starting before
dispatch completes does not double-fire or drop the turn.

## 6b.4 — half-duplex wired to real TTS start/end

**Missing:** `HalfDuplexGate` exists and is unit/integration-tested against a synthetic clock,
but nothing calls `onTtsStart` / `onTtsEnd` from the actual TTS lifecycle, and the capture
stream is not yet muted by the gate in the live path.

**Test once landed:** simulate a full reply cycle — interviewer TTS start → speaking → end →
guard tail — against the live capture path and assert mic frames are dropped for the whole
speaking window plus `guardMs`, that no `utteranceStart` fires from TTS echo, and that
push-to-talk still forces capture open as the fallback path.

---

### Notes
- Config: `vitest.config.ts` `include` now lists `tests/integration/**/*.{test,spec}.{ts,tsx}`
  so files in this dir run. Keep new 6b.2–6b.4 integration tests here.
- The streaming cores under `src/main/voice/streaming/` are pure (no `electron` import), so
  integration tests over them need no electron mock. Seams above cross into IPC/worker/TTS and
  will need the `electron` alias mock (`tests/mocks/electron.ts`) or a fake at those boundaries.
