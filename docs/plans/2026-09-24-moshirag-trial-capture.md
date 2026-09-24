# MoshiRAG trial capture implementation plan

Goal: preserve enough evidence from one launch-to-teardown trial to measure latency, resource use, and later billed cost without publishing interview data.

Architecture: AWS remains temporary GPU compute. The worker writes one private, encrypted diagnostic object before shutdown. The local app keeps the transcript in its existing audit store and, only with separate consent, writes input and output PCM to userData. A local trial collector records phase and resource measurements by trial ID. Billing data is a later annotation, not a launch-time estimate.

Tech stack: Python 3.12, AWS CLI v2, CloudFormation, S3, Electron main process, TypeScript, Vitest, unittest.

## Data contract

- Trial ID: UUID, generated at launch, emitted in stack outputs and gateway health, tagged on the EC2 instance.
- Local trial observations outside the checkout: schema version, trial and observation IDs, account, region, stack, instance, AMI, instance type, UTC observation and launch times, bundle SHA, resource facts, metric period and unit, missing-data reasons, and observed instance state. No prompt, transcript, audio, token, or secret.
- Local media: separate opt-in input and output `f32le` PCM files, 24 kHz mono, plus a small manifest with sample counts and incomplete status. They remain under Electron userData and never enter source control or CI artifacts.
- Worker diagnostic object: one S3 key scoped to the trial ID, SSE-S3, private bucket required. Capture bounded journal tail and service exit state before shutdown. Retrieve locally, inspect, then delete the object and bucket when done.
- Cost: capture launch/observation bounds, EBS size, and CloudWatch CPU/network quantities without a price estimate. Append posted AWS cost only after billing refresh, with source and attribution limits. Unknown stays unknown.

## Tasks

### 1. Trial identity and private diagnostics

Files: `infra/aws-demo/demo.py`, `infra/aws-demo/test_demo.py`, `demo/moshi-gateway/bootstrap.sh`, `demo/moshi-gateway/diagnostics.sh`, `demo/moshi-gateway/gateway.py`, `demo/moshi-gateway/test_gateway.py`, `.github/workflows/aws-demo.yml`.

1. Write failing tests for trial ID propagation, S3 write scope, public-access preflight, bounded diagnostic upload, and health identity.
2. Run `python -m unittest discover -s infra/aws-demo -v` and gateway tests. Confirm expected failures.
3. Add minimal template, gateway, and shutdown-hook changes. Keep immediate shutdown and independent deadline intact even if diagnostic upload fails.
4. Run focused tests, worker shell syntax, and CloudFormation lint. Confirm no secrets or interview content in infrastructure output.

### 2. Local session timing and media

Files: `app/src/main/voice/moshi/demo.ts`, `app/src/main/voice/moshi/demo.test.ts`, `app/src/main/ipc/moshi-demo.ts`, `app/src/main/ipc/moshi-demo.test.ts`, `app/src/main/voice/moshi/trial-capture.ts`, `app/src/main/voice/moshi/trial-capture.test.ts`, `app/src/preload/index.d.ts`, `app/src/renderer/src/demo/MoshiDemoView.tsx`, `app/src/renderer/src/demo/useMoshiInterviewSession.ts`.

1. Write failing tests for start-to-ready, gap-to-next-audio, ping round-trip, final drain, input/output sample counts, partial sessions, and no media when consent is absent.
2. Run focused Vitest tests and confirm each failure comes from missing behavior.
3. Record monotonic durations and bounded counters in a local per-session manifest. Add explicit media consent; stream PCM locally without blocking the interview if storage fails.
4. Verify fixture path, cancellation, renderer close, and failed startup. No audio or transcript in metrics or AWS objects.

### 3. Launch-to-teardown resource collector

Files: `infra/aws-demo/trial.py`, `infra/aws-demo/test_trial.py`, `infra/aws-demo/README.md`, `docs/stages/stage-06e-native-full-duplex.md`.

1. Write failing tests for atomic local snapshots, missing AWS fields, failed startup, termination, metric units and periods, no fabricated dollar amount, and late cost annotation.
2. Run `python -m unittest discover -s infra/aws-demo -v` and confirm expected failures.
3. Add read-only AWS `capture` and local `billing` annotation commands. `capture` obtains CloudFormation/EC2/CloudWatch observations. `billing` records posted data only when explicitly invoked and labels account-level costs as unattributed unless trial-only attribution is proved.
4. Document exact trial commands, polling cadence, retention, deletion, and billing lag. A live launch is not part of CI.

### 4. Integration gate and review

1. Run gateway and AWS unit/integration CI, app focused tests, typecheck, lint, production build, and packaged Electron smoke.
2. Use a local fixture to prove one linked trial ID yields infrastructure and session records, while forced startup failure still preserves terminal evidence.
3. Simplify the diff without changing behavior. Inspect privacy, shutdown, and measurement correctness. Review before PR.
4. Commit one-line Conventional Commits and open a concise issue-linked PR. Do not launch paid AWS resources until tests and review pass.
