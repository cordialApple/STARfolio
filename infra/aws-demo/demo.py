import argparse
import base64
import hashlib
import json
import math
import re
import shlex
import subprocess
import sys
import tarfile
import tempfile
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
    "diagnostics.sh",
    "conditioner_worker.py",
    "gateway.py",
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
    if not math.isfinite(hours) or not 0.5 <= hours <= 6:
        raise ValueError("hours must be between 0.5 and 6")
    bucket = config["bundle_s3_uri"].removeprefix("s3://").split("/", 1)[0]
    return {
        "name": config["name"],
        "region": config["region"],
        "instance_type": instance_type,
        "deadline": timestamp(now + timedelta(hours=hours)),
        "lifetime_hours": hours,
        "trial_id": trial_id,
        "diagnostics_s3_uri": f"s3://{bucket}/trials/{trial_id}/worker.log",
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


def make_inline_policy(name, statements):
    return {
        "PolicyName": name,
        "PolicyDocument": {"Version": "2012-10-17", "Statement": statements},
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


def make_worker_role(config, plan):
    bundle_arn = "arn:${AWS::Partition}:s3:::" + config["bundle_s3_uri"].removeprefix(
        "s3://"
    )
    diagnostics_arn = "arn:${AWS::Partition}:s3:::" + plan[
        "diagnostics_s3_uri"
    ].removeprefix("s3://")
    return {
        "Type": "AWS::IAM::Role",
        "Properties": {
            "AssumeRolePolicyDocument": make_trust_policy("ec2.amazonaws.com"),
            "Policies": [
                make_inline_policy(
                    "SessionManager",
                    [
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
                        }
                    ],
                ),
                make_inline_policy(
                    "ReadDemoBundle",
                    [
                        {
                            "Effect": "Allow",
                            "Action": "s3:GetObject",
                            "Resource": {"Fn::Sub": bundle_arn},
                        }
                    ],
                ),
                make_inline_policy(
                    "WriteTrialDiagnostics",
                    [
                        {
                            "Effect": "Allow",
                            "Action": "s3:PutObject",
                            "Resource": {"Fn::Sub": diagnostics_arn},
                        }
                    ],
                ),
                make_inline_policy(
                    "ReadHuggingFaceToken",
                    [
                        {
                            "Effect": "Allow",
                            "Action": "secretsmanager:GetSecretValue",
                            "Resource": config["hf_token_secret_arn"],
                        }
                    ],
                ),
            ],
        },
    }


def make_template(config, plan, root_device):
    name = config["name"]
    bootstrap = make_bootstrap(config, plan)
    network_properties = (
        {"SecurityGroupIds": [{"Ref": "SecurityGroup"}]}
        if config["subnet"] is None
        else {
            "NetworkInterfaces": [
                {
                    "AssociatePublicIpAddress": True,
                    "DeviceIndex": "0",
                    "SubnetId": config["subnet"],
                    "GroupSet": [{"Ref": "SecurityGroup"}],
                }
            ]
        }
    )
    lambda_code = """import boto3

def handler(event, context):
    ec2 = boto3.client('ec2')
    result = ec2.describe_instances(Filters=[
        {'Name': 'tag:StarfolioDemo', 'Values': [event['name']]},
        {'Name': 'instance-state-name', 'Values': ['pending', 'running', 'stopping', 'stopped']},
    ])
    ids = [instance['InstanceId'] for reservation in result['Reservations'] for instance in reservation['Instances']]
    if ids:
        ec2.terminate_instances(InstanceIds=ids)
    return {'terminated': len(ids)}
"""
    resources = {
        "SecurityGroup": {
            "Type": "AWS::EC2::SecurityGroup",
            "Properties": {
                "GroupDescription": "Starfolio demo outbound HTTPS only; inbound through SSM",
                "VpcId": config["vpc"],
                "SecurityGroupIngress": [],
                "SecurityGroupEgress": [
                    {
                        "IpProtocol": "tcp",
                        "FromPort": 443,
                        "ToPort": 443,
                        "CidrIp": "0.0.0.0/0",
                    },
                    {
                        "IpProtocol": "tcp",
                        "FromPort": 80,
                        "ToPort": 80,
                        "CidrIp": "0.0.0.0/0",
                    },
                ],
            },
        },
        "WorkerRole": make_worker_role(config, plan),
        "WorkerProfile": {
            "Type": "AWS::IAM::InstanceProfile",
            "Properties": {"Roles": [{"Ref": "WorkerRole"}]},
        },
        "DeadlineRole": {
            "Type": "AWS::IAM::Role",
            "Properties": {
                "AssumeRolePolicyDocument": make_trust_policy("lambda.amazonaws.com"),
                "Policies": [
                    make_inline_policy(
                        "TerminateDemo",
                        [
                            {
                                "Effect": "Allow",
                                "Action": "ec2:DescribeInstances",
                                "Resource": "*",
                            },
                            {
                                "Effect": "Allow",
                                "Action": "ec2:TerminateInstances",
                                "Resource": {
                                    "Fn::Sub": "arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/*"
                                },
                                "Condition": {
                                    "StringEquals": {
                                        "ec2:ResourceTag/StarfolioDemo": name
                                    }
                                },
                            },
                        ],
                    )
                ],
            },
        },
        "DeadlineFunction": {
            "Type": "AWS::Lambda::Function",
            "Properties": {
                "Runtime": "python3.12",
                "Handler": "index.handler",
                "Timeout": 30,
                "MemorySize": 128,
                "Role": {"Fn::GetAtt": ["DeadlineRole", "Arn"]},
                "Code": {"ZipFile": lambda_code},
            },
        },
        "ScheduleRole": {
            "Type": "AWS::IAM::Role",
            "Properties": {
                "AssumeRolePolicyDocument": make_trust_policy(
                    "scheduler.amazonaws.com"
                ),
                "Policies": [
                    make_inline_policy(
                        "InvokeDeadline",
                        [
                            {
                                "Effect": "Allow",
                                "Action": "lambda:InvokeFunction",
                                "Resource": {"Fn::GetAtt": ["DeadlineFunction", "Arn"]},
                            }
                        ],
                    )
                ],
            },
        },
        "DeadlineSchedule": {
            "Type": "AWS::Scheduler::Schedule",
            "Properties": {
                "ScheduleExpression": "at(" + plan["deadline"].removesuffix("Z") + ")",
                "ScheduleExpressionTimezone": "UTC",
                "FlexibleTimeWindow": {"Mode": "OFF"},
                "State": "ENABLED",
                "Target": {
                    "Arn": {"Fn::GetAtt": ["DeadlineFunction", "Arn"]},
                    "RoleArn": {"Fn::GetAtt": ["ScheduleRole", "Arn"]},
                    "Input": json.dumps({"name": name}),
                    "RetryPolicy": {
                        "MaximumEventAgeInSeconds": 300,
                        "MaximumRetryAttempts": 5,
                    },
                },
            },
        },
        "Worker": {
            "Type": "AWS::EC2::Instance",
            "DependsOn": ["DeadlineSchedule"],
            "Properties": {
                "ImageId": config["ami"],
                "InstanceType": plan["instance_type"],
                "IamInstanceProfile": {"Ref": "WorkerProfile"},
                "InstanceInitiatedShutdownBehavior": "terminate",
                "MetadataOptions": {
                    "HttpTokens": "required",
                    "HttpEndpoint": "enabled",
                    "HttpPutResponseHopLimit": 1,
                },
                **network_properties,
                "BlockDeviceMappings": [
                    {
                        "DeviceName": root_device,
                        "Ebs": {
                            "VolumeSize": 150,
                            "VolumeType": "gp3",
                            "Encrypted": True,
                            "DeleteOnTermination": True,
                        },
                    }
                ],
                "Tags": [
                    {"Key": "Name", "Value": name},
                    {"Key": TAG_KEY, "Value": name},
                    {"Key": "StarfolioTrial", "Value": plan["trial_id"]},
                    {"Key": "DemoDeadline", "Value": plan["deadline"]},
                ],
                "UserData": base64.b64encode(bootstrap.encode()).decode(),
            },
        },
    }
    return {
        "AWSTemplateFormatVersion": "2010-09-09",
        "Description": "One temporary MoshiRAG worker with independent deadline termination",
        "Resources": resources,
        "Outputs": {
            "InstanceId": {"Value": {"Ref": "Worker"}},
            "Deadline": {"Value": plan["deadline"]},
            "TrialId": {"Value": plan["trial_id"]},
        },
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


def instance_from_outputs(stack):
    return next(
        (
            entry["OutputValue"]
            for entry in stack.get("Outputs", [])
            if entry["OutputKey"] == "InstanceId"
        ),
        None,
    )


def stack_instance(aws, name):
    stack = aws("cloudformation", "describe-stacks", "--stack-name", name)["Stacks"][0]
    instance = instance_from_outputs(stack)
    if instance:
        return instance
    result = aws(
        "cloudformation",
        "describe-stack-resource",
        "--stack-name",
        name,
        "--logical-resource-id",
        "Worker",
    )
    return result["StackResourceDetail"]["PhysicalResourceId"]


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
    if args.command in ("plan", "launch", "upload"):
        plan = make_plan(config, trial_id=getattr(args, "trial_id", None))
        if args.command == "plan":
            output = {
                "plan": plan,
                "template": make_template(config, plan, "/dev/sda1"),
            }
            if args.output:
                args.output.write_text(
                    json.dumps(output, indent=2) + "\n", encoding="utf-8"
                )
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
            ensure_no_active_demo(aws)
            root = preflight(aws, config)
            plan = make_plan(config, trial_id=args.trial_id)
            with tempfile.TemporaryDirectory(prefix="starfolio-demo-") as directory:
                path = Path(directory) / "template.json"
                path.write_text(
                    json.dumps(make_template(config, plan, root)), encoding="utf-8"
                )
                result = aws(
                    "cloudformation",
                    "create-stack",
                    "--stack-name",
                    config["name"],
                    "--template-body",
                    "file://" + path.as_posix(),
                    "--capabilities",
                    "CAPABILITY_IAM",
                    "--on-failure",
                    "DELETE",
                    "--timeout-in-minutes",
                    "20",
                    "--tags",
                    f"Key={TAG_KEY},Value={config['name']}",
                )
                print(
                    json.dumps(
                        {
                            "stack": result,
                            "plan": plan,
                            "next": "Run status until CREATE_COMPLETE; then tunnel and check http://127.0.0.1:8765/health.",
                        },
                        indent=2,
                    )
                )
    elif args.command == "delete":
        print(
            json.dumps(
                aws("cloudformation", "delete-stack", "--stack-name", config["name"])
            )
        )
        print(
            "Deletion requested. Run status until stack is absent; verify instance terminated and bundle deleted from S3."
        )
    elif args.command == "status":
        stack = aws(
            "cloudformation", "describe-stacks", "--stack-name", config["name"]
        )["Stacks"][0]
        result = {
            "stack_status": stack["StackStatus"],
            "outputs": stack.get("Outputs", []),
        }
        instance = instance_from_outputs(stack)
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
        instance = stack_instance(aws, config["name"])
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
