# Remote MoshiRAG PR pass

Status: completed through PRs #313, #314, and #315. Documentation reconciliation is issue #311.
Live GPU evidence remains issue #312.

## Goal

Replace the oversized MoshiRAG branch with focused, issue-linked changes that keep STARfolio local and
use AWS only for temporary GPU compute.

## Slices

1. Recorder integrity: stream ordered frames without retaining full sessions; preserve push-to-talk;
   drain trailing PCM before shutdown.
2. Worker foundation: pin source and model revisions; validate complete bundles; bind the runtime to
   loopback; enforce heartbeat, deadline, disconnect, and teardown behavior.
3. Desktop integration: keep retrieval, planning, scoring, reducer state, persistence, reports, and
   audit local; gate remote audio behind an explicit experimental preference.
4. Documentation: reconcile the compute boundary, stage status, CI layers, development directions,
   branch state, and Git conventions.
5. Live validation: run a real temporary GPU interview and publish startup, transcript, rigor, latency,
   disconnect, deadline, and teardown evidence.

## Review contract

- Raise one focused issue before each implementation PR.
- Use `<type>/<short-kebab-purpose>` branches and one-line Conventional Commits.
- Keep PR statements direct and under 200 characters.
- Write focused unit tests first, integration tests at boundaries, and Electron E2E for the feature.
- Run simplification, focused inspection, adjudication, current-base CI, then squash merge.
- Make no live-quality claim before issue #312 produces hardware evidence.

## Result

- PR #313 merged recorder streaming and final-drain behavior.
- PR #314 merged the temporary AWS worker, gateway, lifecycle automation, and worker CI.
- PR #315 merged the default-off desktop interview path after unit, integration, build, and packaged
  Electron E2E gates passed.
- The original consolidation branch is superseded. Its durable decisions now live in the roadmap,
  architecture docs, stage docs, and `CONTEXT.md`.
