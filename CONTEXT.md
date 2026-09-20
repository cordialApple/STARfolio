# CONTEXT.md

_Last updated: 2026-09-19 21:43 · branch: docs/reconcile-development-roadmap · session: MoshiRAG consolidation_

## 1. What changed this session
- PRs #313, #314, and #315 split and merged recorder integrity, temporary AWS GPU compute, and the default-off remote interview path.
- PR #317 stabilizes cold-start extractor tests with CI-only serialization and a scoped XLSX timeout.
- Project docs now state that STARfolio and durable data stay on a normal local machine while MoshiRAG alone uses temporary AWS GPU compute.
- Roadmap, stage status, provider routing, privacy egress, CI direction, PersonalServer status, and Git conventions are reconciled.
- Superseded worktrees and proven merged, patch-equivalent, or superseded branches are removed; only `main` and this docs branch remain locally.

## 2. Decisions made and why
- AWS is compute, not a STARfolio backend — no local GPU is assumed, while storage, retrieval, planning, scoring, reducer state, reports, and audit remain local.
- Live GPU quality is a separate evidence gate — fixture CI proves contracts and lifecycle, not model fit, transcript quality, latency, rigor, or real teardown.
- Money estimates do not drive the roadmap — budget policy can be configured operationally later.
- Development uses issue-first slices, human branch names, one-line Conventional Commits, short PR statements, focused tests, simplification, inspection, adjudication, and squash merge.

## 3. What was tested and how
- Remote interview PR #315 — hosted lint, typecheck, 878 unit/integration tests, production package, and full packaged Electron E2E — passed; its repeated extractor timeout was fixed by PR #317.
- CI stability PR #317 — two local CI-mode full suites, focused config/extractor tests, lint, typecheck, hosted unit/integration, production package, packaged Electron E2E, and post-merge `main` CI — passed.
- AWS worker PR #314 — source/build contract, gateway integration, lifecycle unit, shell, CloudFormation, and bundle gates — passed in hosted CI.
- Documentation branch — `git diff --check`, local-link resolution, and stale-status scans — passed before review.

## 4. Files needing attention
- `docs/roadmap.md` — broad active directions; keep it as the forward source of truth.
- `docs/stages/stage-06e-native-full-duplex.md` — issue #312 must supply live GPU and teardown evidence.
- `docs/plans/pbt-in-ci.md` — PR/push budgets, rotating seed, failure artifacts, fixture promotion, and coverage ledger remain open.
- `docs/personalserver-config-handshake.md` — confirm the external PersonalServer reader accepts the shipped config shape.
- `docs/development/branch-reconciliation.md` — remove the active docs branch entry after this PR merges only if another reconciliation pass is needed.

## 5. Next step
Execute issue #312 on a temporary AWS GPU and publish the live interview, rigor comparison, and teardown evidence.
