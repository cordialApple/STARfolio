# Restart-safe worker implementation plan

**Goal:** A service restart cannot power off the interview worker; a completed session or observed child failure can.

**Architecture:** The worker writes a completion marker in RAM only after `wait -n` identifies a child exit. The root stop hook checks that marker against systemd's invocation ID before requesting poweroff. The independent AWS deadline remains the final cleanup path. The sampler stops in the host shutdown transaction, not through a nested `systemctl stop` in the demo stop hook.

**Tech stack:** Bash, systemd, Python `unittest`, AWS demo bundle.

---

### Task 1: Capture expected worker behavior

**Files:** `demo/moshi-gateway/test_run_worker.py`, `demo/moshi-gateway/test_runtime_inputs.py`, `infra/aws-demo/test_demo.py`

1. Add tests that reject a completion marker after SIGTERM and require one after identified child exit.
2. Add stop-hook tests for matching, missing, stale, and malformed invocation IDs.
3. Require a single guarded stop hook and no nested sampler stop in the generated unit.
4. Run focused tests and confirm they fail for the missing behavior.

### Task 2: Implement stop guard

**Files:** `demo/moshi-gateway/run-worker.sh`, `demo/moshi-gateway/stop-worker.sh`, `demo/moshi-gateway/bootstrap.sh`, `infra/aws-demo/demo.py`

1. Clear stale marker at invocation start; atomically publish current invocation ID only after observed child exit.
2. Guard root poweroff by exact invocation ID; absent or malformed metadata leaves the host under its hard deadline.
3. Replace unconditional stop hooks and include the helper in the immutable bundle.
4. Run focused tests, then all gateway and AWS-demo tests. Check Bash syntax and diff whitespace.

### Task 3: Verify and publish

**Files:** `infra/aws-demo/README.md`, PR #353

1. Document restart-safe teardown and remaining live canary gate.
2. Run simplifier and independent review if agent capacity permits.
3. Commit once with a one-line Conventional Commit, push, wait for CI, and keep PR draft.
4. Retry one approved synthetic Virginia canary with a 40-minute hard cap. Check restart, health, marker exclusion, numeric telemetry, and root-volume removal before any real interview.
