# GPU Trial Telemetry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve GPU memory evidence from boot through one MoshiRAG interview, including process failures and termination.

**Architecture:** CloudWatch Agent publishes coarse device metrics. A separate worker-side sampler records device and compute-process samples, merges immutable in-process PyTorch peak events, and uploads short private checkpoints to a trial-specific S3 prefix. Capture starts before model loading; local spool and upload receipts distinguish missing data from zero use.

**Tech Stack:** Python 3.12, PyTorch, NVIDIA SMI, systemd, AWS CLI/S3, CloudWatch Agent, CloudFormation, `unittest`.

---

### Task 1: Cloud resource contract

**Files:** `infra/aws-demo/demo.py`, `infra/aws-demo/test_demo.py`, `demo/moshi-gateway/cloudwatch-gpu.json`.

1. Write failing tests for a trial-specific telemetry S3 prefix, least-privilege `s3:PutObject`, CloudWatch `PutMetricData`, bundled agent config, and a metrics-only CloudWatch configuration.
2. Run `python -m unittest infra.aws-demo.test_demo` or `python -m unittest discover -s infra/aws-demo -p test_demo.py -v`; confirm expected failures.
3. Add the plan and IAM fields. Use `trials/<trial-id>/gpu/` for immutable checkpoint objects. Keep logs and interview media out of CloudWatch configuration.
4. Re-run focused tests and preserve generated-template validity.

### Task 2: Independent sampler and durable checkpoints

**Files:** `demo/moshi-gateway/gpu_sampler.py`, `demo/moshi-gateway/test_gpu_sampler.py`.

1. Write failing tests for first sample before model load, device and compute-process fields, absent values as `null`, PID/start identity, immutable event ingestion, atomic local files, independent periodic uploads, upload retry, and incomplete checkpoint detection.
2. Run `python -m unittest discover -s demo/moshi-gateway -p test_gpu_sampler.py -v`; confirm missing functionality fails.
3. Implement fixed numeric schema with trial ID, UTC and monotonic time, GPU UUID, device total/used/free, process PID/used memory/known role, and actual interval. Sample about every 250 ms. Upload short immutable S3 segments about every 5 seconds with SSE-S3; retain failed segments for retry until the 40-minute host deadline. Avoid silently dropping evidence to impose a byte cap.
4. Re-run focused tests. Never capture command lines, environment, prompts, audio, transcripts, or token values.

### Task 3: In-process PyTorch peaks

**Files:** `demo/moshi-gateway/gpu_peaks.py`, `demo/moshi-gateway/test_gpu_peaks.py`, `demo/moshi-gateway/interview_worker.py`, `demo/moshi-gateway/conditioner_worker.py`.

1. Write failing tests for total and phase high-water marks, current allocated/reserved bytes, absent CUDA, CUDA OOM, process identity, and atomic numeric event publication.
2. Run `python -m unittest discover -s demo/moshi-gateway -p test_gpu_peaks.py -v`; confirm failures.
3. Wrap existing main processes without editing upstream source. Emit immutable per-process events into the sampler spool before load, during initialization and active session, on failure, and on exit. Do not reset global peak counters before persisting phase results.
4. Re-run focused tests and existing interview-worker tests.

### Task 4: Boot and teardown integration

**Files:** `demo/moshi-gateway/bootstrap.sh`, `demo/moshi-gateway/run-worker.sh`, `demo/moshi-gateway/diagnostics.sh`, `demo/moshi-gateway/test_runtime_inputs.py`, `infra/aws-demo/test_demo.py`.

1. Write failing integration tests for sampler start before model load, CloudWatch Agent installation/configuration, upload permissions, final checkpoint attempt, and retained private diagnostics.
2. Run focused gateway and infrastructure tests; confirm expected failures.
3. Start sampler and agent as independent systemd services. Do not let model crash stop sampler. Preserve existing 40-minute host deadline and one-session exit behavior. Record upload receipt and gaps; upload telemetry before shutdown where possible.
4. Re-run all gateway and infrastructure tests.

### Task 5: Docs, verification, and PR

**Files:** `infra/aws-demo/README.md`, `demo/moshi-gateway/README.md`, this plan.

1. Document observed peak versus true instantaneous peak, PyTorch allocator versus device memory, S3 checkpoint retention, CloudWatch metric names, privacy boundary, and no-MLflow rationale for one trial.
2. Run `python -m unittest discover -s infra/aws-demo -v` and `python -m unittest discover -s demo/moshi-gateway -v`; run repository CI-equivalent checks where feasible.
3. Inspect CloudFormation template and bundle, verify clean diff, simplify once, and review failure/privacy paths.
4. Commit with one-line Conventional Commits. Open concise PR closing #342. Merge only after required CI and reliability review pass. No live worker launch belongs to this code slice.
