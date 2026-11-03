# Terraform GPU worker migration

Goal: replace CloudFormation provisioning with native Terraform AWS resources. Keep Python preflight, SSM, scoped IAM, deadline termination, and GPU telemetry.

1. Add failing tests for native resources, persistent state, launch refusal, and cleanup.
2. Generate Terraform JSON configuration and deterministic Lambda archive. Pin provider versions and checksums.
3. Route launch/status/stop/tunnel/delete through Terraform state. Keep offline `plan`; preserve interrupted deployments for cleanup.
4. Remove observer dependency on CloudFormation; discover workers through demo and trial tags.
5. Update CI and operating instructions. Validate generated configuration and mock Terraform apply/destroy without AWS calls.
6. Run lifecycle tests, relevant gateway tests, and simplifier. Export reviewable diff.

No AWS deployment during migration. Existing CloudFormation stacks remain separately owned; require explicit legacy cleanup before replacement launch.

Completed locally: native resource generation, persistent state ownership, lifecycle commands, tagged observer, provider lock, CI, and recovery docs. Simplifier completed.

Validation: 56 lifecycle tests (one Linux-only skip); 73 gateway tests; Terraform validate and mocked apply/destroy; expired-deadline rejection; worker shell syntax; archive packaging. First gateway run hit existing 20 ms teardown timing assertion; original revision and rerun passed. Live AWS permissions and teardown remain unverified.
