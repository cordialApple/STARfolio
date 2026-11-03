import argparse
import base64
import hashlib
import io
import json
import math
import os
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import zipfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

INSTANCE_VCPUS = {
    "g6e.2xlarge": 8,
    "g6e.4xlarge": 16,
    "g6e.8xlarge": 32,
    "g6e.16xlarge": 64,
}
TAG_KEY = "StarfolioDemo"
BUNDLE_FILES = (
    "README.md",
    "bootstrap.sh",
    "cloudwatch-gpu.json",
    "diagnostics.sh",
    "conditioner_worker.py",
    "gateway.py",
    "gpu_peaks.py",
    "gpu_sampler.py",
    "interview_worker.py",
    "interview_protocol.py",
    "requirements-build.in",
    "requirements-build.lock",
    "requirements.lock",
    "requirements.txt",
    "run-worker.sh",
)


def timestamp(value):
    return (
        value.astimezone(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def secret_region_and_account(config):
    match = re.fullmatch(
        r"arn:aws:secretsmanager:(us-(?:east-[12]|west-[12])):(\d{12}):secret:[A-Za-z0-9/_+=.@-]{1,512}",
        str(config.get("hf_token_secret_arn", "")),
    )
    if not match:
        raise ValueError("Invalid or missing hf_token_secret_arn")
    return match.group(1), match.group(2)


def selected_instance(config):
    instance_type = config.get("instance_type", "g6e.2xlarge")
    if not isinstance(instance_type, str) or instance_type not in INSTANCE_VCPUS:
        raise ValueError("Invalid instance_type")
    return instance_type


def make_plan(config, now=None, trial_id=None):
    now = now or datetime.now(timezone.utc)
    trial_id = str(uuid4()) if trial_id is None else trial_id
    try:
        parsed_trial_id = UUID(trial_id)
    except ValueError as error:
        raise ValueError("trial_id must be a UUIDv4") from error
    if parsed_trial_id.version != 4 or str(parsed_trial_id) != trial_id:
        raise ValueError("trial_id must be a UUIDv4")
    if "hf_token" in config:
        raise ValueError("Store the Hugging Face token in AWS Secrets Manager")
    patterns = {
        "name": r"starfolio-demo(?:-[a-z0-9-]{1,32})?",
        "region": r"us-(?:east-[12]|west-[12])",
        "ami": r"ami-[0-9a-f]{8,17}",
        "ami_owner": r"\d{12}",
        "vpc": r"vpc-[0-9a-f]{8,17}",
        "bundle_sha256": r"[0-9a-f]{64}",
        "bundle_s3_uri": r"s3://[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]/[A-Za-z0-9/_.-]+",
    }
    for key, pattern in patterns.items():
        if not re.fullmatch(pattern, str(config.get(key, ""))):
            raise ValueError(f"Invalid or missing {key}")
    if "subnet" not in config or (
        config["subnet"] is not None
        and not re.fullmatch(r"subnet-[0-9a-f]{8,17}", str(config["subnet"]))
    ):
        raise ValueError("Invalid or missing subnet")
    secret_region_and_account(config)
    instance_type = selected_instance(config)
    hours = float(config.get("hours"))
    if not math.isfinite(hours) or not 0.5 <= hours <= 2 / 3:
        raise ValueError("hours must be between 0.5 and 2/3")
    bucket = config["bundle_s3_uri"].removeprefix("s3://").split("/", 1)[0]
    return {
        "name": config["name"],
        "region": config["region"],
        "instance_type": instance_type,
        "deadline": timestamp(now + timedelta(hours=hours)),
        "lifetime_hours": hours,
        "trial_id": trial_id,
        "diagnostics_s3_uri": f"s3://{bucket}/trials/{trial_id}/worker.log",
        "telemetry_s3_prefix": f"s3://{bucket}/trials/{trial_id}/gpu/",
    }


def aws_client(region):
    def call(service, operation, *args):
        command = [
            "aws",
            "--region",
            region,
            "--no-cli-pager",
            "--output",
            "json",
            service,
            operation,
            *args,
        ]
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        return json.loads(result.stdout) if result.stdout.strip() else {}

    return call


def ensure_no_legacy_stack(aws, name):
    try:
        aws("cloudformation", "describe-stacks", "--stack-name", name)
    except subprocess.CalledProcessError as error:
        detail = error.stderr or ""
        if (
            "ValidationError" in detail
            and f"Stack with id {name} does not exist" in detail
        ):
            return
        raise
    raise ValueError(
        "Legacy CloudFormation stack exists; delete it and wait for deletion before Terraform launch"
    )


def ensure_no_active_demo(aws):
    result = aws(
        "ec2",
        "describe-instances",
        "--filters",
        json.dumps(
            [
                {"Name": "tag-key", "Values": [TAG_KEY]},
                {
                    "Name": "instance-state-name",
                    "Values": [
                        "pending",
                        "running",
                        "stopping",
                        "stopped",
                        "shutting-down",
                    ],
                },
            ]
        ),
    )
    if any(row["Instances"] for row in result.get("Reservations", [])):
        raise ValueError(
            "An active demo already exists in this region; delete it before launching another"
        )


def preflight(aws, config):
    instance_type = selected_instance(config)
    required_vcpus = INSTANCE_VCPUS[instance_type]
    _, secret_account = secret_region_and_account(config)
    if aws("sts", "get-caller-identity")["Account"] != secret_account:
        raise ValueError("Hugging Face secret account must match AWS account")
    images = aws("ec2", "describe-images", "--image-ids", config["ami"]).get(
        "Images", []
    )
    if len(images) != 1:
        raise ValueError("AMI not found")
    image = images[0]
    if (
        image.get("State") != "available"
        or image.get("OwnerId") != config["ami_owner"]
        or image.get("Architecture") != "x86_64"
        or image.get("RootDeviceType") != "ebs"
        or image.get("PlatformDetails") != "Linux/UNIX"
        or image.get("ProductCodes")
    ):
        raise ValueError(
            "AMI must be available x86_64 Linux/UNIX with EBS root, no marketplace product charges, and the expected owner"
        )
    root = image["RootDeviceName"]
    for device in image.get("BlockDeviceMappings", []):
        if "Ebs" in device and (
            device["DeviceName"] != root or device["Ebs"].get("VolumeSize", 0) > 150
        ):
            raise ValueError(
                "AMI must have only one EBS volume, no larger than 150 GiB"
            )
    auto_placement = config["subnet"] is None
    if auto_placement:
        vpcs = aws("ec2", "describe-vpcs", "--vpc-ids", config["vpc"])["Vpcs"]
        if (
            len(vpcs) != 1
            or not vpcs[0].get("IsDefault")
            or vpcs[0].get("State") != "available"
        ):
            raise ValueError("Automatic placement requires an available default VPC")
        subnets = aws(
            "ec2",
            "describe-subnets",
            "--filters",
            json.dumps([{"Name": "vpc-id", "Values": [config["vpc"]]}]),
        )["Subnets"]
        default_subnets = [subnet for subnet in subnets if subnet.get("DefaultForAz")]
        if not default_subnets or any(
            subnet.get("VpcId") != config["vpc"]
            or subnet.get("State") != "available"
            for subnet in default_subnets
        ):
            raise ValueError("Automatic placement needs available default subnets")
        if any(not subnet.get("MapPublicIpOnLaunch") for subnet in default_subnets):
            raise ValueError("Every default subnet must assign a public IP")
        subnet_ids = [subnet["SubnetId"] for subnet in default_subnets]
    else:
        subnet = aws("ec2", "describe-subnets", "--subnet-ids", config["subnet"])[
            "Subnets"
        ][0]
        if subnet["VpcId"] != config["vpc"] or subnet["State"] != "available":
            raise ValueError("Subnet must be available in the configured VPC")
        subnet_ids = [config["subnet"]]
    tables = aws(
        "ec2",
        "describe-route-tables",
        "--filters",
        json.dumps(
            [
                {"Name": "vpc-id", "Values": [config["vpc"]]},
            ]
        ),
    )["RouteTables"]
    main = [
        table
        for table in tables
        if any(a.get("Main") for a in table.get("Associations", []))
    ]
    for subnet_id in subnet_ids:
        explicit = [
            table
            for table in tables
            if any(
                association.get("SubnetId") == subnet_id
                for association in table.get("Associations", [])
            )
        ]
        if not any(
            route.get("DestinationCidrBlock") == "0.0.0.0/0"
            and route.get("GatewayId", "").startswith("igw-")
            and route.get("State") == "active"
            for table in (explicit or main)
            for route in table.get("Routes", [])
        ):
            raise ValueError(
                "Subnet needs a direct internet gateway route; this demo does not create NAT gateways"
            )
    offering_filters = [{"Name": "instance-type", "Values": [instance_type]}]
    if not auto_placement:
        offering_filters.append(
            {"Name": "location", "Values": [subnet["AvailabilityZone"]]}
        )
    offerings = aws(
        "ec2",
        "describe-instance-type-offerings",
        "--location-type",
        "availability-zone",
        "--filters",
        json.dumps(offering_filters),
    )["InstanceTypeOfferings"]
    offered_zones = {offering.get("Location") for offering in offerings}
    if auto_placement and not any(
        subnet["AvailabilityZone"] in offered_zones for subnet in default_subnets
    ):
        raise ValueError("GPU type is not offered in any default subnet zone")
    if not auto_placement and not offerings:
        raise ValueError("GPU type is not offered in the selected availability zone")
    quota = aws(
        "service-quotas",
        "get-service-quota",
        "--service-code",
        "ec2",
        "--quota-code",
        "L-DB2E81BA",
    )["Quota"]["Value"]
    if quota < required_vcpus:
        raise ValueError(
            f"Running On-Demand G and VT quota must be at least {required_vcpus} vCPUs; remaining account capacity is checked by EC2 at launch"
        )
    bucket, key = config["bundle_s3_uri"].removeprefix("s3://").split("/", 1)
    location = (
        aws("s3api", "get-bucket-location", "--bucket", bucket).get(
            "LocationConstraint"
        )
        or "us-east-1"
    )
    if location != config["region"]:
        raise ValueError("Bundle bucket must be in the demo region")
    public_access = aws(
        "s3api", "get-public-access-block", "--bucket", bucket
    )["PublicAccessBlockConfiguration"]
    if not all(
        public_access.get(setting) is True
        for setting in (
            "BlockPublicAcls",
            "IgnorePublicAcls",
            "BlockPublicPolicy",
            "RestrictPublicBuckets",
        )
    ):
        raise ValueError("Demo bucket must block all public access")
    artifact = aws("s3api", "head-object", "--bucket", bucket, "--key", key)
    if (
        artifact.get("Metadata", {}).get("sha256") != config["bundle_sha256"]
        or not 0 < artifact.get("ContentLength", 0) <= 10_000_000
    ):
        raise ValueError(
            "S3 bundle missing, oversized, or SHA metadata differs; run upload first"
        )
    return root


def make_trust_policy(service):
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"Service": service},
                "Action": "sts:AssumeRole",
            },
        ],
    }


def make_bootstrap(config, plan):
    bundle = config["bundle_s3_uri"]
    secret_region, _ = secret_region_and_account(config)
    max_seconds = round(plan["lifetime_hours"] * 3600)
    return (
        "\n".join(
            [
                "#!/bin/bash",
                "set -euo pipefail",
                "trap 'shutdown -h now' ERR",
                f"export STARFOLIO_DEMO_DEADLINE={shlex.quote(plan['deadline'])}",
                f"export STARFOLIO_TRIAL_ID={shlex.quote(plan['trial_id'])}",
                f"export STARFOLIO_TRIAL_DIAGNOSTICS_URI={shlex.quote(plan['diagnostics_s3_uri'])}",
                f"export STARFOLIO_TRIAL_GPU_URI={shlex.quote(plan['telemetry_s3_prefix'])}",
                f"export STARFOLIO_DEMO_MAX_SECONDS={max_seconds}",
                'systemd-run --unit=starfolio-instance-deadline --on-active="${STARFOLIO_DEMO_MAX_SECONDS}s" /sbin/shutdown -h now',
                "command -v aws >/dev/null",
                "command -v python3.12 >/dev/null",
                "nvidia-smi >/dev/null",
                "systemctl is-active --quiet amazon-ssm-agent || systemctl is-active --quiet snap.amazon-ssm-agent.amazon-ssm-agent",
                "install -d -m 755 /opt/starfolio-demo",
                f"aws s3 cp {shlex.quote(bundle)} /opt/starfolio-demo/bundle.tar.gz --region {config['region']} --only-show-errors",
                f'echo "{config["bundle_sha256"]}  /opt/starfolio-demo/bundle.tar.gz" | sha256sum --check --status',
                "tar --extract --gzip --file /opt/starfolio-demo/bundle.tar.gz --directory /opt/starfolio-demo --no-same-owner --no-same-permissions",
                "chmod -R a+rX,go-w /opt/starfolio-demo",
                f"export STARFOLIO_HF_TOKEN_SECRET_ARN={shlex.quote(config['hf_token_secret_arn'])}",
                f"export STARFOLIO_HF_TOKEN_SECRET_REGION={shlex.quote(secret_region)}",
                f"export AWS_REGION={shlex.quote(config['region'])}",
                "cd /opt/starfolio-demo",
                "bash demo/moshi-gateway/bootstrap.sh",
            ]
        )
        + "\n"
    )


def make_worker_policy(config, plan):
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "SessionManager",
                "Effect": "Allow",
                "Action": [
                    "ssm:UpdateInstanceInformation",
                    "ssmmessages:CreateControlChannel",
                    "ssmmessages:CreateDataChannel",
                    "ssmmessages:OpenControlChannel",
                    "ssmmessages:OpenDataChannel",
                ],
                "Resource": "*",
            },
            {
                "Effect": "Allow",
                "Action": "s3:GetObject",
                "Resource": "arn:aws:s3:::"
                + config["bundle_s3_uri"].removeprefix("s3://"),
            },
            {
                "Effect": "Allow",
                "Action": "s3:PutObject",
                "Resource": "arn:aws:s3:::"
                + plan["diagnostics_s3_uri"].removeprefix("s3://"),
            },
            {
                "Effect": "Allow",
                "Action": "s3:PutObject",
                "Resource": "arn:aws:s3:::"
                + plan["telemetry_s3_prefix"].removeprefix("s3://")
                + "*",
            },
            {
                "Effect": "Allow",
                "Action": "cloudwatch:PutMetricData",
                "Resource": "*",
                "Condition": {
                    "StringEquals": {"cloudwatch:namespace": "STARfolio/MoshiRAG"}
                },
            },
            {
                "Effect": "Allow",
                "Action": "secretsmanager:GetSecretValue",
                "Resource": config["hf_token_secret_arn"],
            },
        ],
    }


def deadline_archive():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        entry = zipfile.ZipInfo("index.py", date_time=(2026, 1, 1, 0, 0, 0))
        entry.external_attr = 0o644 << 16
        archive.writestr(entry, Path(__file__).with_name("deadline.py").read_bytes())
    return output.getvalue()


def make_terraform(config, plan):
    _, account = secret_region_and_account(config)
    name = config["name"]
    trial_id = plan["trial_id"]
    prefix = name[:16] + "-" + hashlib.sha256(name.encode()).hexdigest()[:8]
    tags = {
        "Name": name,
        TAG_KEY: name,
        "StarfolioTrial": trial_id,
        "DemoDeadline": plan["deadline"],
    }
    termination_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {"Effect": "Allow", "Action": "ec2:DescribeInstances", "Resource": "*"},
            {
                "Effect": "Allow",
                "Action": "ec2:TerminateInstances",
                "Resource": f"arn:aws:ec2:{config['region']}:{account}:instance/*",
                "Condition": {
                    "StringEquals": {
                        "ec2:ResourceTag/StarfolioDemo": name,
                        "ec2:ResourceTag/StarfolioTrial": trial_id,
                    }
                },
            },
        ],
    }
    invoke_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": "lambda:InvokeFunction",
                "Resource": "${aws_lambda_function.deadline.arn}",
            }
        ],
    }
    return {
        "terraform": {
            "required_version": ">= 1.7.0, < 2.0.0",
            "required_providers": {
                "aws": {"source": "hashicorp/aws", "version": "= 6.21.0"}
            },
        },
        "locals": {"deadline": plan["deadline"]},
        "provider": {
            "aws": {
                "region": config["region"],
                "allowed_account_ids": [account],
                "default_tags": {"tags": tags},
            }
        },
        "resource": {
            "aws_security_group": {
                "worker": {
                    "name_prefix": prefix + "-",
                    "description": "Starfolio outbound HTTP/HTTPS; inbound through SSM",
                    "vpc_id": config["vpc"],
                    "ingress": [],
                    "egress": [
                        {
                            "protocol": "tcp",
                            "from_port": port,
                            "to_port": port,
                            "cidr_blocks": ["0.0.0.0/0"],
                            "ipv6_cidr_blocks": [],
                            "prefix_list_ids": [],
                            "security_groups": [],
                            "self": False,
                            "description": "",
                        }
                        for port in (443, 80)
                    ],
                }
            },
            "aws_iam_role": {
                label: {
                    "name_prefix": prefix + "-" + label + "-",
                    "assume_role_policy": json.dumps(make_trust_policy(service)),
                }
                for label, service in (
                    ("worker", "ec2.amazonaws.com"),
                    ("deadline", "lambda.amazonaws.com"),
                    ("schedule", "scheduler.amazonaws.com"),
                )
            },
            "aws_iam_role_policy": {
                label: {
                    "name": label,
                    "role": "${aws_iam_role." + label + ".id}",
                    "policy": json.dumps(policy),
                }
                for label, policy in (
                    ("worker", make_worker_policy(config, plan)),
                    ("deadline", termination_policy),
                    ("schedule", invoke_policy),
                )
            },
            "aws_iam_instance_profile": {
                "worker": {
                    "name_prefix": prefix + "-",
                    "role": "${aws_iam_role.worker.name}",
                }
            },
            "aws_lambda_function": {
                "deadline": {
                    "function_name": prefix + "-deadline",
                    "runtime": "python3.12",
                    "handler": "index.handler",
                    "timeout": 30,
                    "memory_size": 128,
                    "role": "${aws_iam_role.deadline.arn}",
                    "filename": "${path.module}/deadline.zip",
                    "source_code_hash": base64.b64encode(
                        hashlib.sha256(deadline_archive()).digest()
                    ).decode(),
                    "depends_on": ["aws_iam_role_policy.deadline"],
                }
            },
            "aws_scheduler_schedule": {
                "deadline": {
                    "name_prefix": prefix + "-",
                    "schedule_expression": "at("
                    + plan["deadline"].removesuffix("Z")
                    + ")",
                    "schedule_expression_timezone": "UTC",
                    "flexible_time_window": {"mode": "OFF"},
                    "state": "ENABLED",
                    "target": {
                        "arn": "${aws_lambda_function.deadline.arn}",
                        "role_arn": "${aws_iam_role.schedule.arn}",
                        "input": json.dumps({"name": name, "trial_id": trial_id}),
                        "retry_policy": {
                            "maximum_event_age_in_seconds": 300,
                            "maximum_retry_attempts": 5,
                        },
                    },
                    "depends_on": ["aws_iam_role_policy.schedule"],
                }
            },
            "aws_instance": {
                "worker": {
                    "ami": config["ami"],
                    "instance_type": plan["instance_type"],
                    "iam_instance_profile": "${aws_iam_instance_profile.worker.name}",
                    "instance_initiated_shutdown_behavior": "terminate",
                    "metadata_options": {
                        "http_tokens": "required",
                        "http_endpoint": "enabled",
                        "http_put_response_hop_limit": 1,
                    },
                    "vpc_security_group_ids": ["${aws_security_group.worker.id}"],
                    **({"subnet_id": config["subnet"]} if config["subnet"] else {}),
                    "associate_public_ip_address": True,
                    "root_block_device": {
                        "volume_size": 150,
                        "volume_type": "gp3",
                        "encrypted": True,
                        "delete_on_termination": True,
                    },
                    "user_data_base64": base64.b64encode(
                        make_bootstrap(config, plan).encode()
                    ).decode(),
                    "tags": tags,
                    "depends_on": [
                        "aws_scheduler_schedule.deadline",
                        "aws_iam_role_policy.worker",
                    ],
                    "lifecycle": {
                        "precondition": [
                            {
                                "condition": '${timecmp(timeadd(timestamp(), "5m"), local.deadline) < 0}',
                                "error_message": "Deadline too close or expired; delete deployment and launch again.",
                            }
                        ]
                    },
                }
            },
        },
        "output": {
            "instance_id": {"value": "${aws_instance.worker.id}"},
            "deadline": {"value": plan["deadline"]},
            "trial_id": {"value": trial_id},
        },
    }


def deployment_directory(config):
    _, account = secret_region_and_account(config)
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library/Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    return base / "STARfolio/terraform" / account / config["region"] / config["name"]


@contextmanager
def deployment_lock(directory):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / ".lifecycle.lock"
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise ValueError(
            f"Deployment busy: {path}. If interrupted, verify no command runs before removing lock."
        ) from error
    try:
        with os.fdopen(descriptor, "w") as output:
            output.write(str(os.getpid()))
        yield
    finally:
        path.unlink()


def prepare_deployment(directory, config, plan):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / "main.tf.json"
    if path.exists():
        raise ValueError("Deployment already exists; run delete before another launch")
    state = directory / "terraform.tfstate"
    if state.exists() and json.loads(state.read_text()).get("resources"):
        raise ValueError(
            "Existing Terraform state owns resources; restore configuration and delete first"
        )
    shutil.copyfile(
        Path(__file__).with_name(".terraform.lock.hcl"),
        directory / ".terraform.lock.hcl",
    )
    (directory / "deadline.zip").write_bytes(deadline_archive())
    write_terraform_config(directory, config, plan)


def write_terraform_config(directory, config, plan):
    (directory / "main.tf.json").write_text(
        json.dumps(make_terraform(config, plan), indent=2) + "\n", encoding="utf-8"
    )


def terraform(directory, *args, capture=False):
    result = subprocess.run(
        ["terraform", "-chdir=" + str(directory), *args, "-no-color"],
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else sys.stderr,
        env={**os.environ, "TF_WORKSPACE": "default"},
    )
    return json.loads(result.stdout) if capture else None


def require_deployment(directory):
    if (
        not (directory / "main.tf.json").is_file()
        or not (directory / "terraform.tfstate").is_file()
    ):
        raise ValueError(
            f"Terraform configuration/state missing at {directory}; restore state before cleanup. Legacy CloudFormation stacks need separate cleanup."
        )


def delete_deployment(directory):
    if not (directory / "main.tf.json").is_file():
        raise ValueError(f"Deployment configuration missing at {directory}")
    if (directory / ".apply-started").exists() or (
        directory / "terraform.tfstate"
    ).exists():
        require_deployment(directory)
        terraform(directory, "init", "-input=false", "-lockfile=readonly")
        terraform(directory, "destroy", "-input=false", "-auto-approve")
    (directory / "main.tf.json").unlink()
    (directory / "deadline.zip").unlink(missing_ok=True)
    (directory / ".apply-started").unlink(missing_ok=True)


def deployment_outputs(directory):
    require_deployment(directory)
    return {
        key: value["value"]
        for key, value in terraform(directory, "output", "-json", capture=True).items()
    }


def tunnel_command(region, instance, port):
    return [
        "aws",
        "--region",
        region,
        "ssm",
        "start-session",
        "--target",
        instance,
        "--document-name",
        "AWS-StartPortForwardingSession",
        "--parameters",
        json.dumps({"portNumber": ["8765"], "localPortNumber": [str(port)]}),
    ]


def pack(source, destination):
    gateway = source / "demo" / "moshi-gateway"
    manifest = {filename: gateway / filename for filename in BUNDLE_FILES}
    for filename, path in manifest.items():
        if path.is_symlink():
            raise ValueError(f"Bundle files cannot be symlinks: {filename}")
        if not path.is_file():
            raise ValueError(f"Source must contain demo/moshi-gateway/{filename}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(destination, "w:gz") as archive:
        for path in manifest.values():
            archive.add(
                path, arcname=path.relative_to(source).as_posix(), recursive=False
            )
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Plan and run one temporary AWS MoshiRAG worker; launch explicitly creates resources."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    package = subparsers.add_parser("pack")
    package.add_argument(
        "--source", type=Path, default=Path(__file__).resolve().parents[2]
    )
    package.add_argument("--output", type=Path, required=True)
    for command in ("plan", "upload", "launch", "status", "tunnel", "stop", "delete"):
        sub = subparsers.add_parser(command)
        sub.add_argument("--config", type=Path, required=True)
        if command == "plan":
            sub.add_argument("--output", type=Path)
            sub.add_argument("--terraform-dir", type=Path)
        if command in ("plan", "launch"):
            sub.add_argument("--trial-id")
        if command == "upload":
            sub.add_argument("--bundle", type=Path, required=True)
        if command == "tunnel":
            sub.add_argument(
                "--local-port",
                type=int,
                choices=range(1024, 65536),
                default=8765,
                metavar="PORT",
            )
    args = parser.parse_args(argv)
    if args.command == "pack":
        print(
            json.dumps(
                {
                    "bundle": str(args.output.resolve()),
                    "bundle_sha256": pack(args.source.resolve(), args.output.resolve()),
                },
                indent=2,
            )
        )
        return
    config = json.loads(args.config.read_text(encoding="utf-8-sig"))
    if not re.fullmatch(
        r"starfolio-demo(?:-[a-z0-9-]{1,32})?", config.get("name", "")
    ) or not re.fullmatch(r"us-(?:east-[12]|west-[12])", config.get("region", "")):
        raise ValueError("Invalid demo name or region")
    aws = aws_client(config["region"])
    if args.command in ("status", "stop", "tunnel"):
        _, account = secret_region_and_account(config)
        if aws("sts", "get-caller-identity")["Account"] != account:
            raise ValueError("Active AWS account differs from Terraform deployment account")
    if args.command in ("plan", "launch", "upload"):
        plan = make_plan(config, trial_id=getattr(args, "trial_id", None))
        if args.command == "plan":
            output = {
                "plan": plan,
                "terraform": make_terraform(config, plan),
            }
            if args.output:
                args.output.write_text(
                    json.dumps(output, indent=2) + "\n", encoding="utf-8"
                )
            if args.terraform_dir:
                prepare_deployment(args.terraform_dir, config, plan)
            print(json.dumps(plan, indent=2))
        elif args.command == "upload":
            if (
                hashlib.sha256(args.bundle.read_bytes()).hexdigest()
                != config["bundle_sha256"]
            ):
                raise ValueError("Bundle SHA256 differs from config")
            subprocess.run(
                [
                    "aws",
                    "--region",
                    config["region"],
                    "s3",
                    "cp",
                    str(args.bundle),
                    config["bundle_s3_uri"],
                    "--sse",
                    "AES256",
                    "--metadata",
                    "sha256=" + config["bundle_sha256"],
                    "--only-show-errors",
                ],
                check=True,
            )
            print("Bundle uploaded; lifecycle not launched.")
        else:
            directory = deployment_directory(config)
            with deployment_lock(directory):
                if (directory / "main.tf.json").exists():
                    raise ValueError(
                        "Deployment already exists; run delete before another launch"
                    )
                ensure_no_legacy_stack(aws, config["name"])
                ensure_no_active_demo(aws)
                preflight(aws, config)
                plan = make_plan(config, trial_id=args.trial_id)
                prepare_deployment(directory, config, plan)
                print(f"Terraform state: {directory}", file=sys.stderr)
                terraform(directory, "init", "-input=false", "-lockfile=readonly")
                plan = make_plan(config, trial_id=plan["trial_id"])
                write_terraform_config(directory, config, plan)
                (directory / ".apply-started").touch(exist_ok=False)
                terraform(directory, "apply", "-input=false", "-auto-approve")
                print(
                    json.dumps(
                        {
                            "state_directory": str(directory),
                            "plan": plan,
                            "next": "Run status, then tunnel and check http://127.0.0.1:8765/health.",
                        },
                        indent=2,
                    )
                )
    elif args.command == "delete":
        directory = deployment_directory(config)
        with deployment_lock(directory):
            delete_deployment(directory)
        print(
            "Terraform resources deleted. Existing S3 bundle and trial artifacts retained."
        )
    elif args.command == "status":
        directory = deployment_directory(config)
        outputs = deployment_outputs(directory)
        result = {"state_directory": str(directory), "outputs": outputs}
        instance = outputs.get("instance_id")
        if instance:
            record = aws("ec2", "describe-instances", "--instance-ids", instance)[
                "Reservations"
            ][0]["Instances"][0]
            result["instance"] = {"id": instance, "state": record["State"]["Name"]}
            result["ssm"] = aws(
                "ssm",
                "describe-instance-information",
                "--filters",
                json.dumps([{"Key": "InstanceIds", "Values": [instance]}]),
            ).get("InstanceInformationList", [])
        print(json.dumps(result, indent=2))
    else:
        instance = deployment_outputs(deployment_directory(config)).get("instance_id")
        if not instance:
            raise ValueError("Worker instance absent from Terraform outputs")
        if args.command == "stop":
            print(
                json.dumps(
                    aws("ec2", "stop-instances", "--instance-ids", instance), indent=2
                )
            )
            print(
                "Stop requested; encrypted disk remains billed until deadline termination or delete. Run status to verify stopped."
            )
        else:
            subprocess.run(
                tunnel_command(config["region"], instance, args.local_port), check=True
            )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        detail = getattr(error, "stderr", None) or str(error)
        print(f"Demo command failed: {detail}", file=sys.stderr)
        sys.exit(1)
