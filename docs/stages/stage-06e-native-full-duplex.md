# Stage 6e: remote native full duplex

Part of the [build plan](../build-plan.md). Read with [full-duplex migration](../architecture/full-duplex-migration.md), [voice](../architecture/voice.md), and [privacy and risks](../architecture/privacy-and-risks.md).

Goal: optional MoshiRAG conversation with barge-in, overlap, and asynchronous gap-scoring, without requiring a GPU-capable PC.

## Boundary

STARfolio still runs on a normal local machine. It owns the experience bank, retrieval, interview plan,
scoring, reducer state, report, and audit history. SSM forwards a desktop port to the loopback gateway
on temporary AWS GPU compute. The worker receives live session audio and selected interview context, returns audio and
transcript events, and terminates after the session deadline.

This mode is default off. It is an optional realism path, not the only way to interview. Local
push-to-talk remains available when remote compute is unavailable or unwanted.

## Status

- [x] 6e.1 Recorder streaming preserves sample order and drains final PCM before shutdown.
- [x] 6e.2 Gateway and temporary AWS worker implement pinned source/model inputs, loopback-only runtime,
  heartbeat, deadline, disconnect, and teardown behavior.
- [x] 6e.3 Default-off desktop integration keeps planning, evidence selection, scoring, reducer state,
  persistence, reporting, and audit local.
- [x] 6e.4 Unit, integration, lifecycle, production-build, and packaged Electron tests cover the control
  path without requiring a GPU.
- [ ] 6e.4a Before the live gate, verify trial-linked local timing and media capture, private worker
  diagnostics, and append-only AWS resource observations. Media needs separate consent; posted cost
  remains unknown until billing refresh. Tracked in issue #334.
- [ ] 6e.5 Live GPU gate: run a real microphone interview, verify returned audio and transcript quality,
  compare gap-scoring with the turn-based baseline, and prove teardown on success, timeout, disconnect,
  and failure. Tracked in issue #312.

## Decision rule

Remote full duplex passes only if it preserves the per-dimension rubric and local audit trail. If it
does not, keep the implementation experimental and use the cascade or local push-to-talk path. A no-go
result is valid evidence; weakening the scorer is not.

**Checkpoint 6e:** issue #312 records a live interview and every teardown path, with an explicit rigor
verdict against the same-answer turn-based baseline.
