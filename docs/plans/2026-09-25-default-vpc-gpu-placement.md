# Default VPC GPU Placement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let EC2 choose an available zone for the temporary GPU worker when every pinned Virginia zone reports insufficient capacity.

**Architecture:** Explicit `"subnet": null` selects automatic placement only in a verified default VPC. Preflight checks every default subnet for public IP assignment and an active internet-gateway route, then confirms at least one default zone offers the instance type. The template omits the network interface and subnet, retains the no-ingress security group, and lets EC2 choose the default subnet.

**Tech Stack:** Python 3.12, `unittest`, AWS CLI, CloudFormation.

---

### Task 1: Show the missing behavior

**Files:**
- Modify: `infra/aws-demo/test_demo.py`

**Step 1: Add a template test**

Use `{**self.config, "subnet": None}`. Assert `make_plan` accepts it. Assert the worker uses `SecurityGroupIds` and omits `NetworkInterfaces`, `SubnetId`, and `AvailabilityZone`.

**Step 2: Add preflight tests**

Provide AWS responses for a default VPC and public default subnets. Assert successful preflight. Then separately assert rejection of a nondefault VPC, a private default subnet, a default subnet without an internet-gateway route, and no eligible zone offering.

**Step 3: Run red tests**

Run `python -m unittest discover -s infra/aws-demo -p test_demo.py -v`. Expected: `subnet: null` fails validation before implementation.

### Task 2: Implement guarded automatic placement

**Files:**
- Modify: `infra/aws-demo/demo.py`

**Step 1: Validate input**

Accept an explicit null subnet. Keep existing subnet-ID validation when a string is supplied. Reject missing subnet key and every other value.

**Step 2: Validate the network**

For null subnet, require the configured VPC to be the region's available default VPC. Check all available default subnets in that VPC have `MapPublicIpOnLaunch` true and an active `0.0.0.0/0` internet-gateway route. Require at least one default zone in the instance-type offerings. Leave explicit-subnet checks intact.

**Step 3: Generate the template**

For null subnet, set `SecurityGroupIds` to the stack security group and omit `NetworkInterfaces`, `SubnetId`, and `AvailabilityZone`. For an explicit subnet, retain current network-interface properties.

**Step 4: Run green tests**

Run `python -m unittest discover -s infra/aws-demo -v` and `git diff --check`. Expected: all runner tests pass, with the existing Linux-only worker-shell skip on Windows.

### Task 3: Document and verify

**Files:**
- Modify: `infra/aws-demo/README.md`

**Step 1: Document the boundary**

Explain that `"subnet": null` uses automatic zone placement only in a checked default VPC with safe default subnets. EC2 still may reject regional capacity. Explicit subnet selection remains supported.

**Step 2: Validate the CloudFormation preview**

Use the ignored local config with `"subnet": null`. Run `plan` and CloudFormation `validate-template`. Confirm the worker has no pinned subnet or zone and retains its security group, deadline, trial tags, and encrypted root volume.

### Task 4: Publish and retry

**Files:**
- Modify only ignored local config after merge: `app/out/aws-demo/config.local.json`
- Append commands and results: `app/out/aws-demo/aws-cli-command-log.md`

**Step 1: Publish**

Commit one conventional line, push the focused branch, and open a short PR closing issue #338. Merge only after CI passes.

**Step 2: Retry once**

Verify all default subnets and no active worker. Generate a fresh trial ID, then launch one 40-minute worker. Capture allocation, model fit, and startup latency if EC2 allocates it. If EC2 rejects regional capacity, stop attempts and report that fit and latency remain unmeasured.
