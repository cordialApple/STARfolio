# CONTEXT.md

_Last updated: 2026-09-20 09:35 · branch: docs/pbt-observation-procedure · session: agent checkpoint validation_

## 1. What changed this session

- PRs #320, #322, and #324 established append-only PBT evidence, encrypted CI transport, durable `pbt-observations` retention, and the retention handoff.
- PR #327 closed issue #326 with pre-command step journals, per-step spools, agent provenance, encrypted local publication, atomic receipts, recovery, and failure-to-fix lifecycle tests.
- PR #329 closed issue #328 after the first real Windows invocation exposed `spawn npm ENOENT`. Windows now launches the active npm CLI through Node without a shell.
- Same-repository PR capture, trusted validation, and durable retention passed for PRs #327 and #329.
- The first real local agent cycle retained 90 unique events across 45 complete campaigns. It recorded 9,000 requested and executed cases, zero failures, and zero diagnostics.
- Issues #330 and #331 track PID-reuse-safe orphan ownership and same-checkpoint concurrent publication reuse.

## 2. Decisions made and why

- AWS supplies temporary GPU compute for MoshiRAG only. STARfolio, durable data, retrieval, planning, scoring, reports, and audit stay on a normal local machine.
- Money estimates do not drive development. CloudWatch budget policy can be configured later.
- Development uses issue-first slices, human branch names, one-line Conventional Commits, short PR statements, focused tests, inspection, adjudication, and squash merge.
- PBT capture records facts only. Raw events never change; corrections, duplicate links, classifications, and dispositions append separately.
- Organic, mutation, and sabotage observations stay separate. Capture produces no dashboard, aggregate metric, yield estimate, or conclusion.
- Observation is an invoked read-only procedure, not scheduled automation. Sol may be used later for the analysis stage, but deterministic code remains solely responsible for capture and preservation.

## 3. What was tested and how

- PR #327 passed hosted build/test, gateway/lifecycle, encrypted capture, trusted validation, and durable retain. PBT run `35515454155` completed the capture-to-retention path.
- PR #329 passed the same gates. PBT run `35516369874` retained the Windows-launcher regression branch.
- Local serial validation passed 983 tests with one skipped before PR #327.
- The real command `npm run pbt:checkpoint -- npm run test:unit -- pbt.test.ts --maxWorkers=1` passed 51 tests across 11 PBT files.
- Retained cycle `agent-8c6b8db391f5baf7acc64665a23ecb68` reopened with 45 starts, 45 matching completions, 90 unique event IDs, 9,000 executed cases, no failures, no annotations, and no diagnostics.
- That cycle kept 42 organic campaigns separate from 3 sabotage campaigns and recorded matching before/after worktree-state hashes.

## 4. Files needing attention

- `docs/pbt-observation-procedure.md` defines the read-only review contract. Its external cursor and append-only observer ledger are intentionally not implemented; later data engineering owns them.
- Issue #330 should bind step ownership to process-start identity or lease expiry.
- Issue #331 should reuse winning ciphertext or serialize concurrent publication of the same checkpoint.
- `docs/plans/pbt-in-ci.md` remains the retention and privacy contract. PR/push budgets and rotating seeds remain later work.
- `docs/stages/stage-06e-native-full-duplex.md` still needs issue #312 live GPU and teardown evidence.
- `docs/personalserver-config-handshake.md` still needs external PersonalServer reader confirmation for the shipped config shape.

## 5. Next step

Continue the next issue-first development slice. Run property tests through `pbt:checkpoint` before and after fixes, then invoke the read-only observation procedure when a retained delta needs review. Keep README free of yield claims until the user completes the later analysis stage.
