# Temporary AWS MoshiRAG worker

This runner creates one temporary GPU worker for MoshiRAG. STARfolio, its data, and its interview brain stay on the normal local machine. Tests and `plan` create nothing. `upload` writes the code bundle, and `launch` creates the worker stack. Desktop AWS authentication stays in the AWS CLI profile or SSO session. No AWS keys enter the app or worker bundle.

## Before launch

- Python 3.10+ and AWS CLI v2 on the desktop. Install the AWS Session Manager plugin for `tunnel`.
- Existing S3 bucket in the chosen region, blocking public access. Bundle object uses SSE-S3; existing bucket is preserved on cleanup.
- Existing VPC/public subnet with a direct internet gateway route. No NAT gateway, load balancer, or public inbound rule is created. Outbound HTTP/HTTPS allows package/model downloads. Local services bind loopback; SSM forwards port 8765.
- Linux x86_64 CUDA AMI with Python 3.12, working NVIDIA driver, AWS CLI, active SSM agent, and systemd. Verify the AMI owner. CLI checks AWS AMI metadata; user data checks installed binaries and stops the instance on failure. AMI package readiness cannot be established from EC2 metadata alone. Marketplace AMIs with product charges are rejected.
- At least eight vCPUs in the region's Running On-Demand G and VT quota. Availability-zone offering is checked. Current free quota and physical GPU capacity can still cause EC2 launch failure.

The worker is one `g6e.2xlarge`: 8 vCPUs, 64 GiB host memory, one L40S with 44 GiB reported GPU memory. Whether both MoshiRAG models fit and meet latency targets still needs live validation. Setup and downloads consume the configured deadline; the default four hours is a total worker lifetime, not interview duration. [AWS specifications](https://docs.aws.amazon.com/ec2/latest/instancetypes/ac.html).

## Run

From the repository root, with an authenticated AWS profile selected:

```powershell
python infra/aws-demo/demo.py pack --output "$env:TEMP\starfolio-demo.tar.gz"
Copy-Item infra/aws-demo/config.example.json infra/aws-demo/config.local.json
```

Fill `config.local.json`: verified AMI/owner/subnet/VPC, worker lifetime, bucket URI, and SHA256 returned by `pack`. Use that SHA256 as the S3 object name.

```powershell
python infra/aws-demo/demo.py plan --config infra/aws-demo/config.local.json --output "$env:TEMP\starfolio-demo-plan.json"
python infra/aws-demo/demo.py upload --config infra/aws-demo/config.local.json --bundle "$env:TEMP\starfolio-demo.tar.gz"
python infra/aws-demo/demo.py launch --config infra/aws-demo/config.local.json
python infra/aws-demo/demo.py status --config infra/aws-demo/config.local.json
python infra/aws-demo/demo.py tunnel --config infra/aws-demo/config.local.json
```

Review the generated plan/template before launch. Offline template previews use `/dev/sda1`; `launch` replaces this with the selected AMI's actual root device. It revalidates the worker deadline after AWS preflight. `CREATE_COMPLETE` means infrastructure exists; it does not mean models finished loading. Wait for SSM Online, start the tunnel, then check `http://127.0.0.1:8765/health` and Interview → Native duplex (remote MoshiRAG) → Test connection. Keep the tunnel command running during the demo.

The launch command creates a new stack only. It never updates or replaces an existing GPU automatically. An existing tagged worker in the region blocks another launch. Use one region for this demo.

## End and cleanup

```powershell
python infra/aws-demo/demo.py stop --config infra/aws-demo/config.local.json
python infra/aws-demo/demo.py status --config infra/aws-demo/config.local.json
python infra/aws-demo/demo.py delete --config infra/aws-demo/config.local.json
python infra/aws-demo/demo.py status --config infra/aws-demo/config.local.json
```

`stop` requests EC2 stop; verify the reported state. The root disk remains until termination. `delete` requests CloudFormation deletion; the final status command should report that the stack does not exist. Independently verify EC2 terminated and delete the uploaded S3 object when finished. The CLI intentionally preserves your existing bucket.

The deadline schedule and narrowly scoped termination Lambda are created **before** the GPU. They terminate the tagged worker even if the desktop disconnects or the worker OS fails. Termination deletes the encrypted 150 GiB gp3 root disk. CloudFormation reverses that dependency on deletion, removing the worker before its deadline protection. A failed creation uses rollback/delete. No stack updates or deadline extension command are provided. [Scheduler CloudFormation contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-scheduler-schedule.html), [SSM port forwarding](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html).

No raw audio or retrieved evidence is placed in cloud infrastructure logs by this runner. Model and bootstrap logs need the gateway's own controls.

## IAM scope

The operator needs EC2 describe/create/stop/terminate and security-group actions, CloudFormation stack actions, IAM role/profile creation and passing, Scheduler creation/deletion, Lambda creation/deletion, Service Quotas read, S3 bucket-location/object read/write, and SSM session actions. The stack-created worker role has only the Session Manager channel actions, exact bundle read, and exact Hugging Face secret read. Deadline role can terminate only instances carrying this stack's `StarfolioDemo` tag. No credential files are created.

## Local verification

```powershell
python -m unittest discover -s infra/aws-demo -v
```

Tests cover worker lifetime, storage and deadline ordering, actual Lambda cleanup filtering, S3 bundle metadata, region networking/quota admission, packaging exclusions, and the SSM tunnel command. They do not establish live AWS permissions, model fit, throughput, or observed teardown.

## Interview validation

AWS supplies GPU compute for MoshiRAG only. Desktop keeps existing storage, retrieval, architect/evaluator providers, canonical transcript, deterministic reducer and saved interview report. Configure those providers before launching a live worker. The updated bundle includes `interview_worker.py` and `interview_protocol.py`; older generic gateways are rejected by protocol health checks. AWS identity, region, instance, and lifecycle details stay outside the application protocol.

In Interview, enter resume, choose Native duplex (remote MoshiRAG), optionally add target job description, select evidence, check connection and review consent. End saves final transcript and report. History retains canonical transcript, per-dimension coverage, source answers, model identifiers and conditioning delivery evidence. Compare scoring replays full answers and captured gap groups; it makes additional evaluator calls for a live session. Save interview audit exports the comparison and evidence.

Stage 6e.1 remains a measurement gate. A fixture pass proves wiring only. First AWS iteration must measure real model startup/fit, ASR completeness, intended versus observed questions, coverage-dimension agreement on the same answers, voice latency and confirmed teardown. Do not treat delivered conditioning as guaranteed command realization or a positive experiment verdict.
