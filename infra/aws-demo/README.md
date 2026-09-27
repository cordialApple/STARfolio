# Temporary AWS MoshiRAG worker

This runner creates one temporary GPU worker for MoshiRAG. STARfolio, its data, and its interview brain stay on the normal local machine. Tests and `plan` create nothing. `upload` writes the code bundle, and `launch` creates the worker stack. Desktop AWS authentication stays in the AWS CLI profile or SSO session. No AWS keys enter the app or worker bundle.

## Before launch

- Python 3.10+ and AWS CLI v2 on the desktop. Install the AWS Session Manager plugin for `tunnel`.
- Existing S3 bucket in the chosen region, blocking public access. Bundle object uses SSE-S3; existing bucket is preserved on cleanup.
- Hugging Face read token in Secrets Manager. Its full ARN may point to another supported US region in the same AWS account. The worker reads that secret from its home-region endpoint without creating a replica.
- Existing VPC/public subnet with a direct internet gateway route, or a default VPC with safe default subnets for automatic placement. No NAT gateway, load balancer, or public inbound rule is created. Outbound HTTP/HTTPS allows package/model downloads. Local services bind loopback; SSM forwards port 8765.
- Linux x86_64 CUDA AMI with Python 3.12, working NVIDIA driver, AWS CLI, active SSM agent, and systemd. Verify the AMI owner. CLI checks AWS AMI metadata; user data checks installed binaries and stops the instance on failure. AMI package readiness cannot be established from EC2 metadata alone. Marketplace AMIs with product charges are rejected.
- Enough regional Running On-Demand G and VT quota for the selected type: 8, 16, 32, or 64 vCPUs. Availability-zone offering is checked. Current free quota and physical GPU capacity can still cause EC2 launch failure.

Default worker is one `g6e.2xlarge`: 8 vCPUs, 64 GiB host RAM, and one L40S with 44 GiB reported GPU memory. The PyTorch speech model needs about 24 GB of GPU memory on its own; this worker also runs a separate reference encoder and local STT. Set `instance_type` to `g6e.4xlarge`, `g6e.8xlarge`, or `g6e.16xlarge` for 128, 256, or 512 GiB host RAM. Each still has one L40S and the same GPU memory. Extra host RAM does not fix GPU out-of-memory. `g6e.xlarge` has only 32 GiB host RAM and is not a validated substitute. First live trial must measure actual fit and latency. Setup and downloads consume the worker's 40-minute maximum lifetime, not just interview time. [MoshiRAG requirements](https://github.com/kyutai-labs/moshi-rag/tree/8c6dfc101b7871baa428424bcdc583b74fb561d9#requirements), [AWS specifications](https://docs.aws.amazon.com/ec2/latest/instancetypes/ac.html).

## Run

From the repository root, with an authenticated AWS profile selected:

```powershell
python infra/aws-demo/demo.py pack --output "$env:TEMP\starfolio-demo.tar.gz"
Copy-Item infra/aws-demo/config.example.json infra/aws-demo/config.local.json
```

Fill `config.local.json`: verified AMI/owner/subnet/VPC, worker lifetime, bucket URI, and SHA256 returned by `pack`. Use that SHA256 as the S3 object name.

For an ordered capacity trial, keep the example's 40-minute `hours` value and set `instance_type` to `g6e.4xlarge`. If EC2 cannot allocate it, capture the failed trial and wait until its stack is fully deleted. Then use a fresh trial ID with `g6e.8xlarge`, followed by `g6e.16xlarge` only if needed. Never start the next size while a worker or stack remains. A regional offering is not proof of live capacity.

Set `"subnet": null` to let EC2 choose a default subnet and zone. This works only with an available default VPC. Preflight requires every default subnet to assign public IPs and have an active internet-gateway route, and at least one default zone must offer the GPU type. EC2 may still reject current capacity. Keep an explicit subnet ID for a pinned zone.

When moving regions, change the worker region, AMI and owner, VPC, public subnet, and bundle bucket URI together. The worker's quota, stack, SSM session, and EC2 metrics follow the worker region. The Hugging Face secret ARN can remain in its original region; preflight checks that its account matches the active AWS identity, and only the secret read uses the ARN's region. No secret value enters local config or the bundle.

```powershell
$trialId = [guid]::NewGuid().ToString()
python infra/aws-demo/demo.py plan --config infra/aws-demo/config.local.json --output "$env:TEMP\starfolio-demo-plan.json" --trial-id $trialId
python infra/aws-demo/demo.py upload --config infra/aws-demo/config.local.json --bundle "$env:TEMP\starfolio-demo.tar.gz"
python infra/aws-demo/demo.py launch --config infra/aws-demo/config.local.json --trial-id $trialId
python infra/aws-demo/demo.py status --config infra/aws-demo/config.local.json
python infra/aws-demo/demo.py tunnel --config infra/aws-demo/config.local.json
```

Review the generated plan/template before launch. Offline template previews use `/dev/sda1`; `launch` replaces this with the selected AMI's actual root device. It revalidates the worker deadline after AWS preflight. `CREATE_COMPLETE` means infrastructure exists; it does not mean models finished loading. Wait for SSM Online, start the tunnel, then check `http://127.0.0.1:8765/health` and Interview → Native duplex (remote MoshiRAG) → Test connection. Keep the tunnel command running during the demo.

The launch command creates a new stack only. It never updates or replaces an existing GPU automatically. An existing tagged worker in the region blocks another launch. Use one region for this demo.

## Keep one trial's evidence

`launch` prints the chosen trial ID. Keep that ID and run the observer after launch, after the interview, and again before deleting the stack:

```powershell
python infra/aws-demo/trial.py --trial-id <trial-id> capture --config infra/aws-demo/config.local.json --profile iamadmin-general
```

The observer prints each AWS CLI command to stderr. It only reads AWS and appends local JSON under your user data directory (`%LOCALAPPDATA%/STARfolio/trials/<trial-id>/observations/` on Windows). Each observation has its own ID and UTC time. It records account, region, stack and instance state, AMI, launch time, EBS size, and raw CloudWatch CPU, network, status-check, and discovered GPU samples. Missing data stays `null` or carries an error; an empty metric series is not zero use. Basic EC2 monitoring gives CPU and network data at five-minute intervals, while status checks are available at one-minute intervals. The GPU agent emits 10-second memory-used, memory-free, memory-total, and utilization series under `STARfolio/MoshiRAG`; the observer keeps raw datapoints and exact dimensions. New series may not appear in `list-metrics` immediately, so capture again later if `gpuMetrics` is empty. [EC2 metric definitions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/viewing_metrics_with_cloudwatch.html), [GPU metric definitions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-NVIDIA-GPU.html), [CloudWatch retrieval limits](https://docs.aws.amazon.com/cli/latest/reference/cloudwatch/get-metric-statistics.html).

The worker records a second, faster view outside CloudWatch. An independent `nvidia-smi` sampler aims for 250 ms intervals and checkpoints short immutable segments about every five seconds to `s3://<bundle-bucket>/trials/<trial-id>/gpu/`. Segment timestamps show actual sampling gaps. Per-process PyTorch events record allocator peaks and OOM/failure states during model load and interview phases. Device memory from `nvidia-smi` includes other processes and non-PyTorch allocations; a PyTorch allocator peak is not total VRAM. The sampled maximum can miss a shorter true peak. Use all three views together when judging whether GPU memory blocked a trial. No MLflow service is needed for this single-worker measurement.

Each successful checkpoint has a local upload receipt with its S3 URI and hash. The sampler validates segment shape before upload and keeps local data until the receipt matches its hash and counts. Malformed or partial local peak files produce numeric-only diagnostic counts, never their names or contents. Failed uploads stay in the private worker spool for retry while the instance lives; the spool has no byte cap, since dropping records would hide the failure. A host deadline or abrupt failure can still lose the last unsent interval, so an absent segment is missing evidence, not zero use. Read private segments with `aws s3 ls s3://<bundle-bucket>/trials/<trial-id>/gpu/ --recursive` and `aws s3 cp` to a private directory. They survive stack deletion in the existing bucket and need separate retention or cleanup. Segments hold GPU measurements and process metadata, not audio, transcripts, prompts, model tokens, or credentials. Do not publish raw diagnostics or interview media.

The app writes a separate timing manifest under Electron `userData/moshi-trials/<session-id>/`. It links to the same trial ID from gateway health and records start-to-health, roadmap, ready, gap-to-next-audio, ping round trips, and input/output sample counts. Immutable `events/*.json` add candidate speech boundaries, audio receipt, and first scheduled voiced output, with sample offsets, renderer clock, playback queue delay, clock source, and explicit unknown uncertainty. Event writes run off the interview thread; session close waits for them. A failed write marks the manifest incomplete, and a partial `.tmp` remains for diagnosis. An interrupted segment stays interrupted; overlap stays ambiguous. These are observed timeline points, not a proven question-to-answer pairing or a measured speaker-to-ear latency. The old gap-to-next-audio field remains a transport proxy. Compare candidate speech end with first voiced output only after checking overlap and segment order. Audio output timing uses `AudioContext.getOutputTimestamp()` when initialized and a renderer-clock schedule estimate otherwise; each event states which. Device capture and speaker hardware delay remain unknown. The optional “Save raw interview audio” box is off by default. If selected, it writes separate 24 kHz mono `input.f32le` and `output.f32le` files there. The existing interview audit keeps the transcript. No interview media enters this repository, the AWS observer, or CI artifacts.

The worker writes up to roughly 1 MiB of bootstrap and service diagnostics to the exact private S3 key in the launch plan, encrypted with SSE-S3. The bucket must block all public access. Fetch that object to a private local directory before deleting it; it may contain interview content or sensitive errors, so do not paste it into issues, PRs, or CI. A missing object means upload failed, not that the worker had no failure. The existing bucket and this object survive stack deletion and need separate cleanup. The app's local media and trial observations also survive the stack and live outside the checkout; back them up before clearing user data. Do not commit logs, media, or observations.

No launch-time dollar figure is called an actual cost. Once AWS posts usage, append the billed amount with its source and scope:

```powershell
python infra/aws-demo/trial.py --trial-id <trial-id> billing --amount <posted-amount> --currency USD --scope account-window --attribution unattributed --window-start <UTC-start> --window-end <UTC-end> --source "AWS Billing export, UnblendedCost"
```

An account-window amount remains unattributed unless that window truly isolates the trial. Use `--scope trial-tag --attribution trial-cost` only if an activated cost-allocation tag supports it, and check that all relevant resources are tagged. Cost Explorer updates at least once every 24 hours, so new costs can lag; tag activation can take time too. AWS allows backfill of tag activation, but only for periods when the resource already carried that tag. Do not use an early zero or a modeled hourly rate as the trial's billed cost. [Cost Explorer refresh](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-enable.html), [cost-allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html), [backfill limits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-allocation-backfill.html).

## End and cleanup

```powershell
python infra/aws-demo/demo.py stop --config infra/aws-demo/config.local.json
python infra/aws-demo/demo.py status --config infra/aws-demo/config.local.json
python infra/aws-demo/demo.py delete --config infra/aws-demo/config.local.json
python infra/aws-demo/demo.py status --config infra/aws-demo/config.local.json
```

`stop` requests EC2 stop; verify the reported state. The root disk remains until termination. `delete` requests CloudFormation deletion; the final status command should report that the stack does not exist. Independently verify EC2 terminated and delete the uploaded S3 object when finished. The CLI intentionally preserves your existing bucket.

The deadline schedule and narrowly scoped termination Lambda are created **before** the GPU. They terminate the tagged worker even if the desktop disconnects or the worker OS fails. Termination deletes the encrypted 150 GiB gp3 root disk. CloudFormation reverses that dependency on deletion, removing the worker before its deadline protection. A failed creation uses rollback/delete. No stack updates or deadline extension command are provided. [Scheduler CloudFormation contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-scheduler-schedule.html), [SSM port forwarding](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html).

Cloud infrastructure logs do not intentionally receive raw audio or retrieved evidence. Worker and bootstrap diagnostics are private but may still contain sensitive content; review before sharing.

## IAM scope

The operator needs EC2 describe/create/stop/terminate and security-group actions, CloudFormation stack actions, IAM role/profile creation and passing, Scheduler creation/deletion, Lambda creation/deletion, Service Quotas read, S3 bucket-location/object read/write, and SSM session actions. The stack-created worker role has only the Session Manager channel actions, exact bundle read, trial-scoped diagnostic and GPU checkpoint writes, GPU metric publishing to `STARfolio/MoshiRAG`, and exact Hugging Face secret read. Deadline role can terminate only instances carrying this stack's `StarfolioDemo` tag. No credential files are created.

## Local verification

```powershell
python -m unittest discover -s infra/aws-demo -v
```

Tests cover worker lifetime, storage and deadline ordering, actual Lambda cleanup filtering, S3 bundle metadata, region networking/quota admission, packaging exclusions, and the SSM tunnel command. They do not establish live AWS permissions, model fit, throughput, or observed teardown.

## Interview validation

AWS supplies GPU compute for MoshiRAG only. Desktop keeps existing storage, retrieval, architect/evaluator providers, canonical transcript, deterministic reducer and saved interview report. Configure those providers before launching a live worker. The updated bundle includes `interview_worker.py` and `interview_protocol.py`; older generic gateways are rejected by protocol health checks. AWS identity, region, instance, and lifecycle details stay outside the application protocol.

In Interview, enter resume, choose Native duplex (remote MoshiRAG), optionally add target job description, select evidence, check connection and review consent. End saves final transcript and report. History retains canonical transcript, per-dimension coverage, source answers, model identifiers and conditioning delivery evidence. Compare scoring replays full answers and captured gap groups; it makes additional evaluator calls for a live session. Save interview audit exports the comparison and evidence.

Stage 6e.1 remains a measurement gate. A fixture pass proves wiring only. First AWS iteration must measure real model startup/fit, ASR completeness, intended versus observed questions, coverage-dimension agreement on the same answers, voice latency and confirmed teardown. Do not treat delivered conditioning as guaranteed command realization or a positive experiment verdict.
