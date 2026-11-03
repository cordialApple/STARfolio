import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import test_demo


class TerraformTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_demo.DemoTests.setUpClass()
        cls.demo = test_demo.DemoTests.demo

    def setUp(self):
        fixture = test_demo.DemoTests()
        fixture.setUp()
        self.config = fixture.config
        self.plan = self.demo.make_plan(self.config)

    def test_native_resources_preserve_deadline_and_policy_dependencies(self):
        config = self.demo.make_terraform(self.config, self.plan)
        resources = config["resource"]
        self.assertNotIn("aws_cloudformation_stack", resources)
        worker = resources["aws_instance"]["worker"]
        self.assertIn("aws_scheduler_schedule.deadline", worker["depends_on"])
        self.assertIn("aws_iam_role_policy.worker", worker["depends_on"])
        self.assertEqual(worker["instance_initiated_shutdown_behavior"], "terminate")
        self.assertEqual(worker["metadata_options"]["http_tokens"], "required")
        self.assertTrue(worker["root_block_device"]["encrypted"])
        self.assertTrue(worker["root_block_device"]["delete_on_termination"])
        self.assertEqual(resources["aws_security_group"]["worker"]["ingress"], [])
        self.assertIn(
            "aws_iam_role_policy.schedule",
            resources["aws_scheduler_schedule"]["deadline"]["depends_on"],
        )
        self.assertIn(
            "aws_iam_role_policy.deadline",
            resources["aws_lambda_function"]["deadline"]["depends_on"],
        )
        self.assertEqual(
            config["provider"]["aws"]["allowed_account_ids"], ["123456789012"]
        )

    def test_terraform_always_uses_default_workspace_for_local_state(self):
        with patch.dict("os.environ", {"TF_WORKSPACE": "other"}), patch.object(
            self.demo.subprocess, "run", return_value=Mock(stdout="{}")
        ) as run:
            self.demo.terraform(Path("state"), "output", "-json", capture=True)
        self.assertEqual(run.call_args.kwargs["env"]["TF_WORKSPACE"], "default")

    def test_state_backed_commands_reject_wrong_aws_account(self):
        with tempfile.TemporaryDirectory() as temporary:
            config_path = Path(temporary) / "config.json"
            config_path.write_text(json.dumps(self.config))
            for command in ("status", "stop", "tunnel"):
                aws = Mock(return_value={"Account": "999999999999"})
                with self.subTest(command=command), patch.object(
                    self.demo, "aws_client", return_value=aws
                ), patch.object(self.demo, "deployment_outputs") as outputs, patch.object(
                    self.demo.subprocess, "run"
                ):
                    with self.assertRaisesRegex(ValueError, "account"):
                        self.demo.main([command, "--config", str(config_path)])
                    outputs.assert_not_called()

    def test_stop_and_tunnel_use_terraform_instance_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            config_path = Path(temporary) / "config.json"
            config_path.write_text(json.dumps(self.config))
            aws = Mock(return_value={"Account": "123456789012"})
            with patch.object(self.demo, "aws_client", return_value=aws), patch.object(
                self.demo, "deployment_outputs", return_value={"instance_id": "i-owned"}
            ), patch.object(self.demo.subprocess, "run") as run, contextlib.redirect_stdout(io.StringIO()):
                self.demo.main(["stop", "--config", str(config_path)])
                aws.assert_any_call("ec2", "stop-instances", "--instance-ids", "i-owned")
                self.demo.main(["tunnel", "--config", str(config_path)])
                self.assertIn("i-owned", run.call_args.args[0])
                self.assertFalse(any(call.args[0] == "cloudformation" for call in aws.call_args_list))

    def test_launch_refuses_existing_configuration_without_overwriting(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "main.tf.json").write_text("existing")
            with self.assertRaisesRegex(ValueError, "delete"):
                self.demo.prepare_deployment(directory, self.config, self.plan)
            self.assertEqual((directory / "main.tf.json").read_text(), "existing")

    def test_generated_package_has_deterministic_lambda_and_committed_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.demo.prepare_deployment(directory, self.config, self.plan)
            self.assertTrue((directory / "deadline.zip").is_file())
            self.assertTrue((directory / ".terraform.lock.hcl").is_file())
            config = json.loads((directory / "main.tf.json").read_text())
            self.assertEqual(config, self.demo.make_terraform(self.config, self.plan))

    def test_terraform_failure_retains_configuration_for_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            config_path = directory / "config.json"
            config_path.write_text(json.dumps(self.config))
            state_dir = directory / "state"
            run = Mock(side_effect=[{}, OSError("apply interrupted")])
            with (
                patch.object(self.demo, "deployment_directory", return_value=state_dir),
                patch.object(self.demo, "aws_client"),
                patch.object(self.demo, "ensure_no_legacy_stack"),
                patch.object(self.demo, "ensure_no_active_demo"),
                patch.object(self.demo, "preflight"),
                patch.object(self.demo, "terraform", run),
            ):
                with self.assertRaisesRegex(OSError, "apply interrupted"):
                    self.demo.main(["launch", "--config", str(config_path)])
            self.assertTrue((state_dir / "main.tf.json").exists())
            self.assertTrue((state_dir / ".apply-started").exists())

    def test_legacy_stack_guard_only_accepts_explicit_absence(self):
        with self.assertRaisesRegex(ValueError, "CloudFormation"):
            self.demo.ensure_no_legacy_stack(
                Mock(return_value={"Stacks": [{}]}), self.config["name"]
            )
        missing = subprocess.CalledProcessError(
            255,
            "aws",
            stderr="ValidationError: Stack with id starfolio-demo does not exist",
        )
        self.demo.ensure_no_legacy_stack(Mock(side_effect=missing), self.config["name"])
        denied = subprocess.CalledProcessError(255, "aws", stderr="AccessDenied")
        with self.assertRaises(subprocess.CalledProcessError):
            self.demo.ensure_no_legacy_stack(
                Mock(side_effect=denied), self.config["name"]
            )

    def test_missing_state_never_falls_back_to_cloudformation(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with self.assertRaisesRegex(ValueError, "state"):
                self.demo.require_deployment(directory)

    def test_cleanup_before_apply_needs_no_state_but_lost_apply_state_blocks(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.demo.prepare_deployment(directory, self.config, self.plan)
            (directory / ".apply-started").touch()
            with self.assertRaisesRegex(ValueError, "state"):
                self.demo.delete_deployment(directory)
            (directory / ".apply-started").unlink()
            with patch.object(self.demo, "terraform") as run:
                self.demo.delete_deployment(directory)
            run.assert_not_called()
            self.assertFalse((directory / "main.tf.json").exists())

    def test_lifecycle_lock_prevents_concurrent_configuration_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with self.demo.deployment_lock(directory):
                with self.assertRaisesRegex(ValueError, "busy"):
                    with self.demo.deployment_lock(directory):
                        self.fail("Concurrent lock acquired")
            self.assertFalse((directory / ".lifecycle.lock").exists())

    def test_maximum_demo_name_fits_generated_aws_names(self):
        config = {**self.config, "name": "starfolio-demo-" + "x" * 32}
        resources = self.demo.make_terraform(config, self.demo.make_plan(config))[
            "resource"
        ]
        for role in resources["aws_iam_role"].values():
            self.assertLessEqual(len(role["name_prefix"]), 38)
        self.assertLessEqual(
            len(resources["aws_lambda_function"]["deadline"]["function_name"]), 64
        )

    def test_same_demo_keeps_unique_lambda_name_across_trials(self):
        first = self.demo.make_terraform(self.config, self.plan)
        second = self.demo.make_terraform(self.config, self.demo.make_plan(self.config))
        self.assertEqual(
            first["resource"]["aws_lambda_function"]["deadline"]["function_name"],
            second["resource"]["aws_lambda_function"]["deadline"]["function_name"],
        )

    def test_stale_deadline_blocks_worker_and_shell_substitutions_stay_literal(self):
        config = self.demo.make_terraform(self.config, self.plan)
        worker = config["resource"]["aws_instance"]["worker"]
        self.assertEqual(
            worker["lifecycle"]["precondition"][0]["condition"],
            '${timecmp(timeadd(timestamp(), "5m"), local.deadline) < 0}',
        )
        self.assertEqual(config["locals"]["deadline"], self.plan["deadline"])
        self.assertNotIn("${STARFOLIO", json.dumps(config))

    def test_delete_failure_keeps_configuration_and_success_removes_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.demo.prepare_deployment(directory, self.config, self.plan)
            (directory / "terraform.tfstate").write_text("{}")
            with patch.object(
                self.demo, "terraform", side_effect=OSError("destroy failed")
            ):
                with self.assertRaises(OSError):
                    self.demo.delete_deployment(directory)
            self.assertTrue((directory / "main.tf.json").exists())
            with patch.object(self.demo, "terraform", return_value={}) as run:
                self.demo.delete_deployment(directory)
            self.assertFalse((directory / "main.tf.json").exists())
            self.assertTrue(any("destroy" in call.args for call in run.call_args_list))

    def test_state_path_survives_checkout_and_separates_accounts_regions_names(self):
        path = self.demo.deployment_directory(self.config)
        self.assertIn("123456789012", path.parts)
        self.assertIn("us-east-2", path.parts)
        self.assertEqual(path.name, "starfolio-demo")
        self.assertNotIn("aws-demo", path.parts)


if __name__ == "__main__":
    unittest.main()
