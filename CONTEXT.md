# CONTEXT.md

_Last updated: 2026-09-20 01:58 · branch: feat/pbt-observation-store · session: PBT observation preservation_

## 1. What changed this session

- PRs #313, #314, and #315 split and merged recorder integrity, temporary AWS GPU compute, and the default-off remote interview path.
- PR #317 stabilizes cold-start extractor tests with CI-only serialization and a scoped XLSX timeout.
- Project docs now state that STARfolio and durable data stay on a normal local machine while MoshiRAG alone uses temporary AWS GPU compute.
- Roadmap, stage status, provider routing, privacy egress, CI direction, PersonalServer status, and Git conventions are reconciled.
- Superseded worktrees and branches are gone. Current worktrees are clean `main` plus the issue #319 feature branch.
- Issue #319 adds append-only PBT raw events, separate annotations, encrypted CI artifact upload, and trusted same-repository cycle retention.

## 2. Decisions made and why

- AWS is compute, not a STARfolio backend. No local GPU is assumed, while storage, retrieval, planning, scoring, reducer state, reports, and audit remain local.
- Live GPU quality is a separate evidence gate. Fixture CI proves contracts and lifecycle, not model fit, transcript quality, latency, rigor, or real teardown.
- Money estimates do not drive the roadmap. Budget policy can be configured operationally later.
- Development uses issue-first slices, human branch names, one-line Conventional Commits, short PR statements, focused tests, simplification, inspection, adjudication, and squash merge.
- PBT capture records facts only. Raw events never change; later corrections, duplicate links, classifications, and dispositions append separately.
- Organic, mutation, and sabotage observations stay separate. Capture produces no dashboard, aggregate metric, yield estimate, or conclusion.

## 3. What was tested and how

- Remote interview PR #315 passed hosted lint, typecheck, 878 unit/integration tests, production package, and full packaged Electron E2E. PR #317 fixed its repeated extractor timeout.
- CI stability PR #317 passed two local CI-mode suites, focused config/extractor tests, lint, typecheck, hosted unit/integration, production package, packaged Electron E2E, and post-merge `main` CI.
- AWS worker PR #314 passed source/build contract, gateway integration, lifecycle unit, shell, CloudFormation, and bundle gates in hosted CI.
- Documentation branch passed `git diff --check`, local-link resolution, and stale-status scans before review.
- PBT recorder slice keeps 45 calls across 11 files. Focused gates cover schema, semantic quarantine, harness capture, encrypted publication, durable reopen, key selection, concurrent branch append, and trusted workflow contracts.
- Final local gates pass lint, node/web typecheck, 953 unit/integration tests with 1 skip, production packaging, and 35 packaged Electron E2E tests. The exact captured PBT command passes 51 tests and produces 90 start/completion events.
- The generated repository key pair encrypted, validated, and reopened a synthetic 90-entry cycle. Trusted manifests rely on the trusted GitHub job and branch history; they are not independently signed.

## 4. Files needing attention

- `docs/roadmap.md` is the forward source of truth for broad active directions.
- `docs/stages/stage-06e-native-full-duplex.md` still needs issue #312 live GPU and teardown evidence.
- `docs/plans/pbt-in-ci.md` now defines append-only capture, retention, privacy, and analysis boundaries. PR/push budgets and rotating seeds remain later work.
- `.github/workflows/pbt-pr-capture.yml` isolates candidate PBT in Docker, then encrypts, validates, and retains same-repository PR evidence with trusted `main` code. `.github/workflows/pbt-retention.yml` retains `main` cycles, while `.github/workflows/pbt-stage-capture.yml` captures and retains `stage/**` cycles. The keyring secret still needs explicit upload approval. After merge, verify retained and reopenable cycles for all three paths before enabling Luna.
- `docs/personalserver-config-handshake.md` still needs external PersonalServer reader confirmation for the shipped config shape.

## 5. Next step

Finish issue #319 through hosted CI, then verify retained and reopenable `main`, same-repository PR, and `stage/**` cycles. Create the read-only Luna observer only after those bootstrap checks. Resume issue #312 afterward.
