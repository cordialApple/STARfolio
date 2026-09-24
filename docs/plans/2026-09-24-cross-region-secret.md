# Cross-region secret implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the temporary Virginia GPU worker read the existing Ohio Hugging Face secret without copying its value or creating a replica.

**Architecture:** Parse the full secret ARN once. Keep the worker stack, bundle, and diagnostics in the configured worker region, but send the one Secrets Manager read to the ARN's region. Check the ARN account against the active AWS identity before launching.

**Tech Stack:** Python 3.12, shell bootstrap, AWS CLI, `unittest`, CloudFormation.

---

### Task 1: Prove the cross-region contract

**Files:**
- Modify: `infra/aws-demo/test_demo.py`
- Test: `infra/aws-demo/test_demo.py`

**Step 1: Write failing tests**

Add tests that set worker region to `us-east-1` and the secret ARN region to `us-east-2`. Assert `make_plan` accepts the config and decoded worker user data exports `STARFOLIO_HF_TOKEN_SECRET_REGION=us-east-2`. Assert bootstrap uses that variable for `get-secret-value`. Add a preflight test where STS account differs from the ARN and expect rejection.

**Step 2: Run tests and verify red**

Run: `python -m unittest infra.aws-demo.test_demo -v` is not import-safe because of the directory name. Use `python -m unittest discover -s infra/aws-demo -p test_demo.py -v`.

Expected: cross-region plan or bootstrap assertion fails before implementation.

### Task 2: Route the secret read

**Files:**
- Modify: `infra/aws-demo/demo.py`
- Modify: `demo/moshi-gateway/bootstrap.sh`
- Test: `infra/aws-demo/test_demo.py`

**Step 1: Implement minimal code**

Validate `arn:aws:secretsmanager:<supported-region>:<12-digit-account>:secret:<name>` with a full match. Extract region for user data and account for preflight. The worker's `aws secretsmanager get-secret-value` command uses `STARFOLIO_HF_TOKEN_SECRET_REGION`; all other worker AWS commands keep `AWS_REGION`.

**Step 2: Run tests and verify green**

Run: `python -m unittest discover -s infra/aws-demo -v`.

Expected: all runner tests pass; Linux-only shell test may skip on Windows.

### Task 3: Document and integrate

**Files:**
- Modify: `infra/aws-demo/README.md`
- Test: `demo/moshi-gateway/test_runtime_inputs.py`

**Step 1: Document region boundary**

State that bundle bucket, AMI, VPC, subnet, quota, stack, SSM, and metrics follow worker region. Existing Hugging Face secret may remain in another supported region. The worker reads only that ARN at its home-region endpoint. No duplicate secret or secret value in config.

**Step 2: Verify**

Run: `python -m unittest discover -s demo/moshi-gateway -v` and `python -m unittest discover -s infra/aws-demo -v`.

Expected: tests pass; no new secret value or interview data appears in bundle.

### Task 4: Publish and prepare Virginia

**Files:**
- Update ignored local config only after merged code: `app/out/aws-demo/config.local.json`
- Keep command trail: `app/out/aws-demo/aws-cli-command-log.md`

**Step 1: Publish**

Commit one-line conventional change. Push branch, open concise PR closing issue #336, wait for focused CI, merge only if checks pass.

**Step 2: Regional setup**

Verify quota approval, AMI owner, subnet route, and bucket public-access block. Create private Virginia bucket, upload new hash-named bundle with SSE-S3 and SHA256 metadata, then update worker region, AMI, subnet, VPC, and bundle URI. Leave Ohio secret ARN unchanged. Use a fresh trial ID and launch only after quota reaches 8 vCPUs.
