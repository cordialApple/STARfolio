# Interview cloud privacy

> **Goal:** Keep interview content off durable storage on the managed GPU worker and make local-only provider routing an explicit, fail-closed choice.

> **Scope:** This protects STARfolio-managed paths. It does not assert zero retention by configured third-party providers. No paid GPU launch occurs in this pass, so live AMI canary validation remains a release gate.

## Context

The current worker exports raw journal and cloud-init diagnostics to S3, runs model and telemetry under one user, and gives the model disk-backed writable paths. The telemetry reader accepts open-ended phase strings and event filenames. Architect, evaluator, and summary routes may send resume, job description, and interview content to configured cloud providers. The UI consent copy does not enforce routing.

## Task 1: Worker storage boundary

Files: `infra/aws-demo/demo.py`, `infra/aws-demo/test_demo.py`, `demo/moshi-gateway/bootstrap.sh`, `demo/moshi-gateway/test_runtime_inputs.py`, `demo/moshi-gateway/diagnostics.sh`.

1. Add tests rejecting diagnostic S3 IAM, URI, bundle entry, and unit hooks while retaining metrics upload.
2. Add tests for model/service isolation: fixed users, RAM-backed writable model paths, no swap or core dumps, and no raw journal export.
3. Run targeted tests and confirm failure.
4. Implement the smallest template and service changes that satisfy tests. Preserve GPU sampler final flush independently of raw diagnostics.
5. Re-run targeted tests and shell syntax checks.

## Task 2: Validated telemetry boundary

Files: `demo/moshi-gateway/gpu_sampler.py`, `demo/moshi-gateway/gpu_peaks.py`, `demo/moshi-gateway/test_gpu_sampler.py`, `demo/moshi-gateway/test_gpu_peaks.py`.

1. Add tests for schema rejection before local durable writes, fixed metadata vocabulary, safe event filenames, and synthetic canary strings.
2. Run targeted tests and confirm failure.
3. Restrict accepted records to explicit numeric and fixed operational fields. Reconstruct accepted records before spool writes; reject malformed files without corrupting valid telemetry.
4. Re-run targeted tests, including concurrent and interrupted-write cases.

## Task 3: Local-provider privacy choice

Files: main AI runtime and Moshi IPC/session modules, renderer interview controls, and focused tests.

1. Add failing tests for strict mode rejecting any non-loopback architect/evaluator/summary provider before interview start and on later replay paths.
2. Add explicit UI choice and consent text distinguishing managed GPU worker from configured AI providers.
3. Implement runtime routing guard using resolved provider destinations rather than preference labels. Store session privacy choice for subsequent evaluation and rigor flows.
4. Run focused main and renderer tests.

## Task 4: Verification and release gate

1. Run targeted unit/integration suites, AWS template checks, and relevant CI-equivalent commands.
2. Inspect generated bundle/template and all configured output paths with synthetic canary content.
3. Run simplifier once on the substantive code diff; rerun tests.
4. Update operator docs with exact retention contract, local data behavior, historical artifact caveat, and live AMI canary gate.
5. Commit in focused one-line Conventional Commits; push branch and open concise issue-linked PR.
6. Do not merge or claim verified non-persistence until live GPU canary and artifact inspection pass. No billable launch without user approval.
