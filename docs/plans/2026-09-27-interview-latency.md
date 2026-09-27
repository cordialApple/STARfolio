# Interview Latency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture defensible speech-response timing and preserve unanswered or overlapping turns before the first live MoshiRAG interview.

**Architecture:** Renderer owns one monotonic clock for captured candidate speech and scheduled assistant voice. Versioned, numeric-only events cross an authenticated session IPC boundary into immutable local trial files. Backend stage events and GPU checkpoints share trial/session identities but retain their own clocks; no cross-host monotonic subtraction or causal claim from timestamp coincidence.

**Tech Stack:** Electron, React, Web Audio, AudioWorklet, TypeScript, Vitest, Python 3.12, S3, CloudWatch.

---

### Task 1: Renderer speech timeline

**Files:** `app/src/renderer/src/demo/speech-timeline.ts`, `app/src/renderer/src/demo/speech-timeline.test.ts`, `app/src/renderer/src/audio/recorder.ts`, `app/src/renderer/src/audio/pcm-processor.js`.

1. Write failing tests for within-buffer speech onset/end, leading silence, VAD hangover, 1,920-sample batching, separate input/output AudioContexts, output queue delay, overlap, and no speech. Use synthetic PCM and injected monotonic times.
2. Run `npm test -- --run app/src/renderer/src/demo/speech-timeline.test.ts`; confirm each missing behavior fails.
3. Implement sample-index speech segments and renderer-clock estimates with explicit method and uncertainty. Keep voice detection numeric; do not capture audio unless user opted in.
4. Run focused tests green, then recorder tests. Preserve existing audio callback behavior and drain guarantees.

### Task 2: Durable local timing events

**Files:** `app/src/main/voice/moshi/trial-capture.ts`, `app/src/main/voice/moshi/trial-capture.test.ts`, `app/src/main/ipc/moshi-demo.ts`, `app/src/main/ipc/moshi-demo.test.ts`, `app/src/preload/index.ts`, `app/src/preload/index.d.ts`.

1. Write failing tests for numeric-only versioned events, session-owner validation, monotonically increasing event sequence, duplicate/out-of-order rejection, atomic immutable writes, partial-file diagnosis, interrupted sessions, unanswered segments, and telemetry failure that cannot block interview audio.
2. Run focused Vitest tests and confirm failures from missing behavior.
3. Add a bounded timing IPC route. Renderer event fields: `schemaVersion`, `sequence`, `kind`, `rendererTimeMs`, `rendererTimeOriginUtcMs`, sample offsets, method, uncertainty, status, and segment/decision IDs where known. Main adds trial/session identity and receipt time. Never send transcript, prompt, raw PCM, or credentials through timing route.
4. Keep old `gapToAudioMs` labeled transport proxy, not primary latency. Durable event files live under Electron `userData/moshi-trials/<session-id>/events/`, outside source checkout.

### Task 3: Hook live renderer and worker stages

**Files:** `app/src/renderer/src/demo/useMoshiInterviewSession.ts`, `app/src/main/voice/moshi/demo.ts`, `demo/moshi-gateway/gateway.py`, `demo/moshi-gateway/interview_worker.py`, focused tests.

1. Write failing integration fixtures for candidate speech end, first scheduled voiced sample, queued playback, cancellation, overlap, no reply, and injected network/playback delay. Assert observed shift within declared frame/detector tolerance.
2. Run tests red; add renderer event emission and per-session sequence. Record microphone ready, first audio received, first scheduled voice, and terminal status.
3. Add only stage boundaries already observable without synchronization or sensitive payloads. Use trial/session/decision IDs and each process's clock identity; do not pretend cross-host clocks are interchangeable.
4. Run focused tests green and full app/gateway CI equivalents.

### Task 4: Lock GPU memory evidence and retention

**Files:** `demo/moshi-gateway/test_gpu_sampler.py`, `demo/moshi-gateway/test_gpu_peaks.py`, `infra/aws-demo/test_trial.py`, `infra/aws-demo/README.md`; production files only if a failing test proves a gap.

1. Confirm user means GPU VRAM path. Test exact bundle contents, CloudWatch series, per-process peaks, immutable S3 segments, upload receipts, null/missing values, and shutdown gaps.
2. Run focused tests red for any discovered weakness; repair minimally, then run all tests green. Do not claim live GPU validation from mocked tests.
3. Document post-launch evidence gate: verify CloudWatch datapoints, S3 segment count/hash/intervals, PyTorch peak events, trial identity, and explicit missing-data record before ending the first trial.

### Task 5: Issue, PR, CI, and handoff

**Files:** `.github/workflows/` only if focused tests are not already in integration CI; `infra/aws-demo/README.md` for trial procedure.

1. Keep issue #344 linked. Run typecheck, lint, focused unit tests, deterministic fixture integration, gateway tests, and packaged-app smoke CI.
2. Use one-line Conventional Commits, concise PR text, and clean branch history. Run one simplifier pass after code changes.
3. Merge only if event integrity and end-to-end deterministic timing checks pass. Keep #312 as live AWS validation gate; do not report actual VRAM or latency before that run.
