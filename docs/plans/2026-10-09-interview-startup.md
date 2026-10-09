# Interview Startup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Catch production dependency gaps before GPU launch and retain content-free startup failure evidence.

**Architecture:** CI installs locked runtime dependencies before importing pinned Moshi server. Interview startup emits fixed numeric stage and failure codes; sampler accepts only exact versioned fields. Existing peak and startup events remain valid.

**Tech Stack:** Python 3.12, unittest, uv lock, GitHub Actions, AWS demo worker.

---

### Task 1: Dependency closure

**Files:** `demo/moshi-gateway/test_runtime_inputs.py`, `demo/moshi-gateway/requirements-runtime.in`, `demo/moshi-gateway/requirements.lock`, `.github/workflows/aws-demo.yml`

1. Write failing tests for `websockets` in runtime input and CI importing pinned server with locked runtime dependencies.
2. Run focused tests; confirm missing dependency and import step cause failures.
3. Add dependency, regenerate hash lock, and add CI import smoke.
4. Run focused tests and lock check; commit with one-line Conventional Commit.

### Task 2: Safe failure evidence

**Files:** `demo/moshi-gateway/test_gpu_peaks.py`, `demo/moshi-gateway/test_gpu_sampler.py`, `demo/moshi-gateway/gpu_peaks.py`, `demo/moshi-gateway/gpu_sampler.py`, `demo/moshi-gateway/interview_worker.py`

1. Write failing tests for fixed numeric startup step and failure category, strict schema, private-text rejection, and original-exception preservation.
2. Run focused tests; confirm they fail for missing diagnostic behavior.
3. Add versioned diagnostic event and narrow operation wrappers without exception text or paths.
4. Run focused and full gateway suites; commit with one-line Conventional Commit.

### Task 3: Upstream entry-point parity

**Files:** `demo/moshi-gateway/test_gpu_peaks.py`, `demo/moshi-gateway/interview_worker.py`

1. Write failing test that Moshi server main runs under `torch.no_grad()`.
2. Run focused test; confirm gradient-enabled call fails.
3. Wrap server entry call with `torch.no_grad()` and rerun tests.
4. Commit with one-line Conventional Commit.

### Task 4: Integration gate

**Files:** `.github/workflows/aws-demo.yml`, PR #353

1. Run relevant Python unit/integration tests, shell syntax, lock validation, and CI.
2. Review privacy schema and diff; simplify code if needed.
3. Push concise commits; keep PR draft until synthetic canary traffic, retention audit, and cloud cleanup all pass.
