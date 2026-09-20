# CONTEXT.md

_Last updated: 2026-09-20 07:04 · branch: docs/pbt-retention-handoff · session: PBT retention bootstrap_

## 1. What changed this session

- PR #320 merged append-only PBT raw events, separate annotations, encrypted CI artifacts, and durable orphan-branch retention. Issue #319 is closed.
- PR #322 merged runner UID/GID ownership for Docker-written PBT spools. Issue #321 is closed.
- Main and stage retention are verified. Runs `35508941238` and `35509297694` retain cycles under `pbt-observations`.
- Temporary branch `stage/pbt-retention-bootstrap` is deleted. Its retained manifest and payload remain available.
- Observer choice changed from Luna to `gpt-5.6-sol` with low reasoning. Observer creation still waits on same-repository PR proof.

## 2. Decisions made and why

- AWS supplies temporary GPU compute for MoshiRAG only. STARfolio, durable data, retrieval, planning, scoring, reports, and audit stay on a normal local machine.
- Money estimates do not drive development. CloudWatch budget policy can be configured later.
- Development uses issue-first slices, human branch names, one-line Conventional Commits, short PR statements, focused tests, inspection, adjudication, and squash merge.
- PBT capture records facts only. Raw events never change; corrections, duplicate links, classifications, and dispositions append separately.
- Organic, mutation, and sabotage observations stay separate. Capture produces no dashboard, aggregate metric, yield estimate, or conclusion.
- Sol observes retained data only. Deterministic code and CI remain solely responsible for capture and preservation.

## 3. What was tested and how

- PR #322 passed hosted lint, typecheck, unit/integration, production packaging, packaged Electron E2E, and AWS checks.
- Main CI run `35508941238` uploaded an encrypted artifact. Retention run `35509263433` validated and durably appended it.
- Stage CI run `35508962520` passed lint, typecheck, unit/integration, production packaging, and packaged Electron E2E.
- Stage PBT run `35509297694` passed candidate property tests, encryption, artifact upload, decryption, schema revalidation, and durable append.
- GitHub API confirmed encrypted artifact `pbt-stage-observations-35509297694-1` and retained `manifest.json` plus `payload.enc`.
- Deleting `stage/pbt-retention-bootstrap` did not remove retained cycle `35509297694/1`.

## 4. Files needing attention

- `.github/workflows/pbt-pr-capture.yml` needs one successful same-repository PR capture, validation, and durable append on fixed `main`.
- `docs/plans/pbt-in-ci.md` remains the retention and privacy contract. PR/push budgets and rotating seeds remain later work.
- `docs/stages/stage-06e-native-full-duplex.md` still needs issue #312 live GPU and teardown evidence.
- `docs/personalserver-config-handshake.md` still needs external PersonalServer reader confirmation for the shipped config shape.

## 5. Next step

Open issue #323's same-repository docs PR and verify its encrypted PBT cycle is retained before creating the read-only Sol observer.
