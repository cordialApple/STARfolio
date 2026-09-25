import base64
import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

MODULE = Path(__file__).with_name("demo.py")
REQUIRED_BUNDLE_FILES = (
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


class DemoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if MODULE.exists():
            spec = importlib.util.spec_from_file_location("demo", MODULE)
            cls.demo = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.demo)
        else:
            cls.demo = None

    def setUp(self):
        self.assertIsNotNone(self.demo, "AWS demo lifecycle implementation missing")
        self.now = datetime(2026, 9, 10, 12, tzinfo=timezone.utc)
        self.config = {
            "name": "starfolio-demo",
            "region": "us-east-2",
            "ami": "ami-0123456789abcdef0",
            "ami_owner": "123456789012",
            "subnet": "subnet-0123456789abcdef0",
            "vpc": "vpc-0123456789abcdef0",
            "hours": 4,
            "bundle_s3_uri": "s3://demo-artifacts/moshi/abc.tar.gz",
            "bundle_sha256": "a" * 64,
            "hf_token_secret_arn": "arn:aws:secretsmanager:us-east-2:123456789012:secret:starfolio/huggingface-AbCdEf",
        }

    def test_plan_rejects_invalid_worker_lifetime(self):
        for value in [0.49, 6.01, float("nan"), float("inf")]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.demo.make_plan({**self.config, "hours": value}, self.now)

    def test_plan_sets_worker_deadline_without_pricing_inputs(self):
        plan = self.demo.make_plan(self.config, self.now)
        self.assertEqual(plan["deadline"], "2026-09-10T16:00:00Z")
        self.assertEqual(plan["lifetime_hours"], 4)
        self.assertEqual(
            set(plan),
            {
                "name",
                "region",
                "instance_type",
                "deadline",
                "lifetime_hours",
                "trial_id",
                "diagnostics_s3_uri",
            },
        )

    def test_plan_links_worker_and_diagnostics_with_unique_trial_id(self):
        trial_id = "19ab818e-2f38-4e71-9b51-84698a30f10d"
        plan = self.demo.make_plan(self.config, self.now, trial_id=trial_id)
        self.assertEqual(plan["trial_id"], trial_id)
        self.assertEqual(
            plan["diagnostics_s3_uri"],
            f"s3://demo-artifacts/trials/{trial_id}/worker.log",
        )
        template = self.demo.make_template(self.config, plan, "/dev/sda1")
        worker = template["Resources"]["Worker"]["Properties"]
        self.assertIn({"Key": "StarfolioTrial", "Value": trial_id}, worker["Tags"])
        self.assertEqual(template["Outputs"]["TrialId"]["Value"], trial_id)

    def test_plan_rejects_supplied_empty_trial_id(self):
        with self.assertRaisesRegex(ValueError, "UUIDv4"):
            self.demo.make_plan(self.config, self.now, trial_id="")

    def test_plan_cli_keeps_supplied_trial_id_for_launch_review(self):
        trial_id = "19ab818e-2f38-4e71-9b51-84698a30f10d"
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config.json"
            output = Path(directory) / "plan.json"
            config.write_text(json.dumps(self.config))
            with contextlib.redirect_stdout(io.StringIO()):
                self.demo.main([
                    "plan", "--config", str(config), "--output", str(output),
                    "--trial-id", trial_id,
                ])
            self.assertEqual(json.loads(output.read_text())["plan"]["trial_id"], trial_id)

    def test_template_installs_deadline_before_gpu_and_protects_storage(self):
        plan = self.demo.make_plan(self.config, self.now)
        template = self.demo.make_template(self.config, plan, "/dev/sda1")
        resources = template["Resources"]
        worker = resources["Worker"]
        self.assertIn("DeadlineSchedule", worker["DependsOn"])
        self.assertEqual(worker["Properties"]["InstanceType"], "g6e.2xlarge")
        self.assertEqual(
            worker["Properties"]["BlockDeviceMappings"][0]["DeviceName"], "/dev/sda1"
        )
        disk = worker["Properties"]["BlockDeviceMappings"][0]["Ebs"]
        self.assertTrue(disk["Encrypted"])
        self.assertTrue(disk["DeleteOnTermination"])
        bootstrap = base64.b64decode(worker["Properties"]["UserData"]).decode()
        self.assertIn("install -d -m 755 /opt/starfolio-demo", bootstrap)
        self.assertIn("chmod -R a+rX,go-w /opt/starfolio-demo", bootstrap)
        self.assertIn("STARFOLIO_DEMO_DEADLINE=2026-09-10T16:00:00Z", bootstrap)
        self.assertIn("STARFOLIO_DEMO_MAX_SECONDS=14400", bootstrap)
        self.assertLess(
            bootstrap.index("starfolio-instance-deadline"),
            bootstrap.index("nvidia-smi"),
        )
        self.assertLess(
            bootstrap.index("starfolio-instance-deadline"), bootstrap.index("aws s3 cp")
        )
        self.assertEqual(
            resources["SecurityGroup"]["Properties"]["SecurityGroupIngress"], []
        )
        schedule = resources["DeadlineSchedule"]["Properties"]
        self.assertEqual(schedule["ScheduleExpression"], "at(2026-09-10T16:00:00)")
        self.assertEqual(schedule["FlexibleTimeWindow"], {"Mode": "OFF"})
        self.assertNotIn("ActionAfterCompletion", schedule)
        self.assertIn(
            "terminate_instances",
            resources["DeadlineFunction"]["Properties"]["Code"]["ZipFile"],
        )

    def test_worker_uses_minimal_inline_session_manager_permissions(self):
        plan = self.demo.make_plan(self.config, self.now)
        template = self.demo.make_template(self.config, plan, "/dev/sda1")
        role = template["Resources"]["WorkerRole"]["Properties"]
        self.assertNotIn("ManagedPolicyArns", role)
        statements = [
            statement
            for policy in role["Policies"]
            for statement in policy["PolicyDocument"]["Statement"]
        ]
        session = next(
            statement
            for statement in statements
            if statement.get("Sid") == "SessionManager"
        )
        self.assertEqual(
            set(session["Action"]),
            {
                "ssm:UpdateInstanceInformation",
                "ssmmessages:CreateControlChannel",
                "ssmmessages:CreateDataChannel",
                "ssmmessages:OpenControlChannel",
                "ssmmessages:OpenDataChannel",
            },
        )
        self.assertEqual(session["Resource"], "*")
        self.assertFalse(
            any(
                "ssm:GetParameter" in action
                for statement in statements
                for action in (
                    statement["Action"]
                    if isinstance(statement["Action"], list)
                    else [statement["Action"]]
                )
            )
        )

    def test_worker_can_read_only_configured_hugging_face_secret(self):
        plan = self.demo.make_plan(self.config, self.now)
        template = self.demo.make_template(self.config, plan, "/dev/sda1")
        policies = template["Resources"]["WorkerRole"]["Properties"]["Policies"]
        statements = [
            statement
            for policy in policies
            for statement in policy["PolicyDocument"]["Statement"]
        ]
        secret_reads = [
            statement
            for statement in statements
            if statement["Action"] == "secretsmanager:GetSecretValue"
        ]
        self.assertEqual(
            secret_reads,
            [
                {
                    "Effect": "Allow",
                    "Action": "secretsmanager:GetSecretValue",
                    "Resource": self.config["hf_token_secret_arn"],
                }
            ],
        )
        bootstrap = base64.b64decode(
            template["Resources"]["Worker"]["Properties"]["UserData"]
        ).decode()
        self.assertIn(self.config["hf_token_secret_arn"], bootstrap)
        self.assertIn("export AWS_REGION=us-east-2", bootstrap)
        self.assertNotIn("hf_example_plaintext_token", json.dumps(template))

    def test_cross_region_worker_uses_secret_home_region(self):
        config = {**self.config, "region": "us-east-1"}
        plan = self.demo.make_plan(config, self.now)
        template = self.demo.make_template(config, plan, "/dev/sda1")
        bootstrap = base64.b64decode(
            template["Resources"]["Worker"]["Properties"]["UserData"]
        ).decode()
        self.assertIn("export AWS_REGION=us-east-1", bootstrap)
        self.assertIn("export STARFOLIO_HF_TOKEN_SECRET_REGION=us-east-2", bootstrap)
        self.assertIn(config["hf_token_secret_arn"], bootstrap)

    def test_default_vpc_placement_omits_pinned_subnet(self):
        config = {**self.config, "subnet": None}
        plan = self.demo.make_plan(config, self.now)
        worker = self.demo.make_template(config, plan, "/dev/sda1")["Resources"]["Worker"]
        properties = worker["Properties"]
        self.assertEqual(properties["SecurityGroupIds"], [{"Ref": "SecurityGroup"}])
        self.assertNotIn("NetworkInterfaces", properties)
        self.assertNotIn("SubnetId", properties)
        self.assertNotIn("AvailabilityZone", properties)
        self.assertEqual(worker["DependsOn"], ["DeadlineSchedule"])
        self.assertTrue(properties["BlockDeviceMappings"][0]["Ebs"]["Encrypted"])

    def test_bootstrap_fetches_secret_from_home_region(self):
        script = (
            MODULE.parents[2] / "demo" / "moshi-gateway" / "bootstrap.sh"
        ).read_text()
        self.assertIn('get-secret-value --secret-id "$STARFOLIO_HF_TOKEN_SECRET_ARN"', script)
        self.assertIn('--region "$STARFOLIO_HF_TOKEN_SECRET_REGION"', script)

    def test_diagnostics_write_is_scoped_and_precedes_shutdown(self):
        plan = self.demo.make_plan(
            self.config,
            self.now,
            trial_id="19ab818e-2f38-4e71-9b51-84698a30f10d",
        )
        template = self.demo.make_template(self.config, plan, "/dev/sda1")
        policies = template["Resources"]["WorkerRole"]["Properties"]["Policies"]
        statements = [
            statement
            for policy in policies
            for statement in policy["PolicyDocument"]["Statement"]
        ]
        writes = [
            statement for statement in statements if statement["Action"] == "s3:PutObject"
        ]
        self.assertEqual(
            writes,
            [
                {
                    "Effect": "Allow",
                    "Action": "s3:PutObject",
                    "Resource": {
                        "Fn::Sub": "arn:${AWS::Partition}:s3:::demo-artifacts/trials/19ab818e-2f38-4e71-9b51-84698a30f10d/worker.log"
                    },
                }
            ],
        )
        bootstrap = base64.b64decode(
            template["Resources"]["Worker"]["Properties"]["UserData"]
        ).decode()
        self.assertIn("STARFOLIO_TRIAL_DIAGNOSTICS_URI", bootstrap)
        worker_bootstrap = (
            MODULE.parents[2] / "demo" / "moshi-gateway" / "bootstrap.sh"
        ).read_text()
        self.assertIn("starfolio-diagnostics.service", worker_bootstrap)
        self.assertLess(
            worker_bootstrap.index("systemctl start starfolio-diagnostics.service"),
            worker_bootstrap.index("ExecStopPost=+/sbin/shutdown -h now"),
        )
        self.assertLess(
            worker_bootstrap.index("systemctl daemon-reload"),
            worker_bootstrap.index("apt-get update"),
        )
        self.assertLess(
            worker_bootstrap.index("trap 'systemctl start starfolio-diagnostics.service"),
            worker_bootstrap.index("nvidia-smi"),
        )

    @unittest.skipUnless(sys.platform.startswith("linux"), "Worker shell test runs on Linux CI")
    def test_diagnostics_uploads_bounded_bootstrap_and_worker_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commands = root / "commands"
            commands.mkdir()
            scripts = {
                "systemctl": "#!/bin/sh\nprintf 'Result=exit-code\\n'\n",
                "journalctl": "#!/bin/sh\nprintf 'worker failure\\n'\n",
                "aws": "#!/bin/sh\ncp \"$3\" \"$TRIAL_CAPTURED\"\n",
            }
            for name, source in scripts.items():
                path = commands / name
                path.write_text(source)
                path.chmod(0o700)
            cloud_init = root / "cloud-init.log"
            cloud_init.write_bytes(b"x" * 1_000_000 + b"bootstrap failure\n")
            captured = root / "captured.log"
            environment = {
                **os.environ,
                "PATH": str(commands) + os.pathsep + os.environ["PATH"],
                "AWS_REGION": "us-east-2",
                "STARFOLIO_TRIAL_DIAGNOSTICS_URI": "s3://private/trials/test/worker.log",
                "STARFOLIO_CLOUD_INIT_LOG": str(cloud_init),
                "TRIAL_CAPTURED": str(captured),
            }
            script = MODULE.parents[2] / "demo" / "moshi-gateway" / "diagnostics.sh"
            subprocess.run(["bash", str(script)], env=environment, check=True)
            data = captured.read_bytes()
            self.assertIn(b"worker failure", data)
            self.assertIn(b"bootstrap failure", data)
            self.assertLess(len(data), 1_100_000)

    def test_cleanup_lambda_only_terminates_matching_instances(self):
        plan = self.demo.make_plan(self.config, self.now)
        template = self.demo.make_template(self.config, plan, "/dev/sda1")
        source = template["Resources"]["DeadlineFunction"]["Properties"]["Code"][
            "ZipFile"
        ]
        ec2 = Mock()
        ec2.describe_instances.return_value = {
            "Reservations": [{"Instances": [{"InstanceId": "i-owned"}]}]
        }
        boto = Mock()
        boto.client.return_value = ec2
        with patch.dict(sys.modules, {"boto3": boto}):
            scope = {}
            exec(source, scope)
            scope["handler"]({"name": "starfolio-demo"}, None)
        filters = ec2.describe_instances.call_args.kwargs["Filters"]
        self.assertIn(
            {"Name": "tag:StarfolioDemo", "Values": ["starfolio-demo"]}, filters
        )
        ec2.terminate_instances.assert_called_once_with(InstanceIds=["i-owned"])

    def test_pack_excludes_credentials_and_python_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gateway = root / "demo" / "moshi-gateway"
            gateway.mkdir(parents=True)
            for filename in REQUIRED_BUNDLE_FILES:
                (gateway / filename).write_text("pass\n")
            (gateway / ".env").write_text("SECRET=hidden")
            (gateway / "credentials.json").write_text('{"key": "hidden"}')
            (gateway / "gateway.pyc").write_bytes(b"cache")
            (gateway / "__pycache__").mkdir()
            (gateway / "__pycache__" / "gateway.pyc").write_bytes(b"cache")
            destination = root / "bundle.tar.gz"
            digest = self.demo.pack(root, destination)
            self.assertEqual(len(digest), 64)
            with tarfile.open(destination) as archive:
                expected = {
                    f"demo/moshi-gateway/{filename}"
                    for filename in REQUIRED_BUNDLE_FILES
                }
                self.assertEqual(set(archive.getnames()), expected)

    def test_pack_rejects_every_missing_manifest_file(self):
        for missing in REQUIRED_BUNDLE_FILES:
            with (
                self.subTest(missing=missing),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                gateway = root / "demo" / "moshi-gateway"
                gateway.mkdir(parents=True)
                for filename in REQUIRED_BUNDLE_FILES:
                    if filename != missing:
                        (gateway / filename).write_text("pass\n")
                with self.assertRaisesRegex(ValueError, missing):
                    self.demo.pack(root, root / "bundle.tar.gz")

    def test_plan_rejects_invalid_hugging_face_secret_arn(self):
        for value in (
            "hf_plaintext_token",
            "arn:aws:secretsmanager:eu-west-1:123456789012:secret:unsupported-region",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.demo.make_plan(
                    {**self.config, "hf_token_secret_arn": value}, self.now
                )
        with self.assertRaises(ValueError):
            self.demo.make_plan(
                {**self.config, "hf_token": "hf_example_plaintext_token"}, self.now
            )

    def test_tunnel_binds_gateway_port(self):
        command = self.demo.tunnel_command("us-east-2", "i-123", 8765)
        self.assertIn("AWS-StartPortForwardingSession", command)
        parameters = json.loads(command[command.index("--parameters") + 1])
        self.assertEqual(
            parameters, {"portNumber": ["8765"], "localPortNumber": ["8765"]}
        )

    def test_launch_refuses_existing_active_demo(self):
        aws = Mock()
        aws.return_value = {
            "Reservations": [{"Instances": [{"InstanceId": "i-running"}]}]
        }
        with self.assertRaisesRegex(ValueError, "active demo"):
            self.demo.ensure_no_active_demo(aws)

    def preflight_responses(self):
        return {
            ("ec2", "describe-images"): {
                "Images": [
                    {
                        "State": "available",
                        "Architecture": "x86_64",
                        "RootDeviceType": "ebs",
                        "RootDeviceName": "/dev/sda1",
                        "OwnerId": "123456789012",
                        "PlatformDetails": "Linux/UNIX",
                        "BlockDeviceMappings": [
                            {"DeviceName": "/dev/sda1", "Ebs": {"VolumeSize": 100}}
                        ],
                    }
                ]
            },
            ("ec2", "describe-subnets"): {
                "Subnets": [
                    {
                        "VpcId": self.config["vpc"],
                        "State": "available",
                        "AvailabilityZone": "us-east-2a",
                    }
                ]
            },
            ("ec2", "describe-route-tables"): {
                "RouteTables": [
                    {
                        "Associations": [{"Main": True}],
                        "Routes": [
                            {
                                "DestinationCidrBlock": "0.0.0.0/0",
                                "GatewayId": "igw-123",
                                "State": "active",
                            }
                        ],
                    }
                ]
            },
            ("s3api", "get-bucket-location"): {"LocationConstraint": "us-east-2"},
            ("s3api", "get-public-access-block"): {
                "PublicAccessBlockConfiguration": {
                    "BlockPublicAcls": True,
                    "IgnorePublicAcls": True,
                    "BlockPublicPolicy": True,
                    "RestrictPublicBuckets": True,
                }
            },
            ("s3api", "head-object"): {
                "Metadata": {"sha256": "a" * 64},
                "ContentLength": 1000,
            },
            ("service-quotas", "get-service-quota"): {"Quota": {"Value": 8}},
            ("sts", "get-caller-identity"): {"Account": "123456789012"},
            ("ec2", "describe-instance-type-offerings"): {
                "InstanceTypeOfferings": [{"InstanceType": "g6e.2xlarge"}]
            },
        }

    def default_vpc_responses(self):
        responses = self.preflight_responses()
        responses[("ec2", "describe-vpcs")] = {
            "Vpcs": [{"VpcId": self.config["vpc"], "IsDefault": True, "State": "available"}]
        }
        responses[("ec2", "describe-subnets")] = {
            "Subnets": [
                {
                    "SubnetId": "subnet-aaaaaaaa",
                    "VpcId": self.config["vpc"],
                    "State": "available",
                    "DefaultForAz": True,
                    "MapPublicIpOnLaunch": True,
                    "AvailabilityZone": "us-east-2a",
                },
                {
                    "SubnetId": "subnet-bbbbbbbb",
                    "VpcId": self.config["vpc"],
                    "State": "available",
                    "DefaultForAz": True,
                    "MapPublicIpOnLaunch": True,
                    "AvailabilityZone": "us-east-2b",
                },
            ]
        }
        responses[("ec2", "describe-route-tables")]["RouteTables"].append(
            {
                "Associations": [{"SubnetId": "subnet-bbbbbbbb"}],
                "Routes": [
                    {
                        "DestinationCidrBlock": "0.0.0.0/0",
                        "GatewayId": "igw-123",
                        "State": "active",
                    }
                ],
            }
        )
        responses[("ec2", "describe-instance-type-offerings")] = {
            "InstanceTypeOfferings": [
                {"InstanceType": "g6e.2xlarge", "Location": "us-east-2a"},
                {"InstanceType": "g6e.2xlarge", "Location": "us-east-2b"},
            ]
        }
        return responses

    def test_default_vpc_preflight_checks_default_network(self):
        responses = self.default_vpc_responses()
        calls = []

        def aws(service, operation, *args):
            calls.append((service, operation, args))
            return responses[(service, operation)]

        config = {**self.config, "subnet": None}
        self.assertEqual(self.demo.preflight(aws, config), "/dev/sda1")
        self.assertTrue(any(call[:2] == ("ec2", "describe-vpcs") for call in calls))
        subnet_calls = [
            args for service, operation, args in calls if operation == "describe-subnets"
        ]
        self.assertTrue(all("--subnet-ids" not in args for args in subnet_calls))

    def test_default_vpc_preflight_rejects_nondefault_vpc(self):
        responses = self.default_vpc_responses()
        responses[("ec2", "describe-vpcs")]["Vpcs"][0]["IsDefault"] = False
        aws = lambda service, operation, *args: responses[(service, operation)]
        with self.assertRaisesRegex(ValueError, "default VPC"):
            self.demo.preflight(aws, {**self.config, "subnet": None})

    def test_default_vpc_preflight_rejects_private_default_subnet(self):
        responses = self.default_vpc_responses()
        responses[("ec2", "describe-subnets")]["Subnets"][1]["MapPublicIpOnLaunch"] = False
        aws = lambda service, operation, *args: responses[(service, operation)]
        with self.assertRaisesRegex(ValueError, "public IP"):
            self.demo.preflight(aws, {**self.config, "subnet": None})

    def test_default_vpc_preflight_rejects_unrouted_default_subnet(self):
        responses = self.default_vpc_responses()
        responses[("ec2", "describe-route-tables")]["RouteTables"][1]["Routes"] = []
        aws = lambda service, operation, *args: responses[(service, operation)]
        with self.assertRaisesRegex(ValueError, "internet gateway"):
            self.demo.preflight(aws, {**self.config, "subnet": None})

    def test_default_vpc_preflight_requires_offered_default_zone(self):
        responses = self.default_vpc_responses()
        responses[("ec2", "describe-instance-type-offerings")]["InstanceTypeOfferings"] = [
            {"InstanceType": "g6e.2xlarge", "Location": "us-east-2c"}
        ]
        aws = lambda service, operation, *args: responses[(service, operation)]
        with self.assertRaisesRegex(ValueError, "offered"):
            self.demo.preflight(aws, {**self.config, "subnet": None})

    def test_preflight_rejects_private_subnet_and_invalid_artifact(self):
        responses = self.preflight_responses()
        aws = lambda service, operation, *args, **kwargs: responses[
            (service, operation)
        ]
        self.assertEqual(self.demo.preflight(aws, self.config), "/dev/sda1")
        responses[("s3api", "get-public-access-block")][
            "PublicAccessBlockConfiguration"
        ]["BlockPublicPolicy"] = False
        with self.assertRaisesRegex(ValueError, "public access"):
            self.demo.preflight(aws, self.config)
        responses[("s3api", "get-public-access-block")][
            "PublicAccessBlockConfiguration"
        ]["BlockPublicPolicy"] = True
        responses[("s3api", "head-object")]["Metadata"]["sha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "bundle"):
            self.demo.preflight(aws, self.config)
        responses[("s3api", "head-object")]["Metadata"]["sha256"] = "a" * 64
        responses[("service-quotas", "get-service-quota")] = {"Quota": {"Value": 0}}
        with self.assertRaisesRegex(ValueError, "quota"):
            self.demo.preflight(aws, self.config)
        responses[("service-quotas", "get-service-quota")] = {"Quota": {"Value": 8}}
        responses[("sts", "get-caller-identity")] = {"Account": "999999999999"}
        with self.assertRaisesRegex(ValueError, "account"):
            self.demo.preflight(aws, self.config)
        responses[("sts", "get-caller-identity")] = {"Account": "123456789012"}
        responses[("ec2", "describe-route-tables")] = {"RouteTables": []}
        with self.assertRaisesRegex(ValueError, "internet gateway"):
            self.demo.preflight(aws, self.config)


if __name__ == "__main__":
    unittest.main()
