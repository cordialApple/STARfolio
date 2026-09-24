import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock
from unittest.mock import patch

MODULE = Path(__file__).with_name("trial.py")
TRIAL_ID = "19ab818e-2f38-4e71-9b51-84698a30f10d"


class TrialTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if MODULE.exists():
            spec = importlib.util.spec_from_file_location("trial", MODULE)
            cls.trial = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.trial)
        else:
            cls.trial = None

    def setUp(self):
        self.assertIsNotNone(self.trial, "Trial observation implementation missing")
        self.config = {"name": "starfolio-demo", "region": "us-east-2"}
        self.now = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
        self.responses = {
            ("sts", "get-caller-identity"): {"Account": "123456789012"},
            ("cloudformation", "describe-stacks"): {
                "Stacks": [{"StackStatus": "CREATE_COMPLETE", "Outputs": [
                    {"OutputKey": "TrialId", "OutputValue": TRIAL_ID},
                    {"OutputKey": "InstanceId", "OutputValue": "i-0123456789abcdef0"},
                ]}]
            },
            ("ec2", "describe-instances"): {"Reservations": [{"Instances": [{
                "InstanceId": "i-0123456789abcdef0",
                "InstanceType": "g6e.2xlarge",
                "ImageId": "ami-0123456789abcdef0",
                "LaunchTime": "2026-09-24T11:00:00+00:00",
                "State": {"Name": "running"},
                "BlockDeviceMappings": [{"Ebs": {"VolumeId": "vol-123"}}],
            }]}]},
            ("ec2", "describe-volumes"): {"Volumes": [{"VolumeId": "vol-123", "Size": 150, "VolumeType": "gp3"}]},
        }

    def aws(self, service, operation, *args):
        if service == "cloudwatch":
            return {"Datapoints": [{"Timestamp": "2026-09-24T11:01:00+00:00", "Sum": 10, "Unit": "Bytes"}]}
        return self.responses[(service, operation)]

    def test_snapshot_preserves_metered_facts_and_units_without_a_price(self):
        calls = Mock(side_effect=self.aws)
        snapshot = self.trial.capture_snapshot(calls, self.config, TRIAL_ID, self.now)
        self.assertEqual(snapshot["schemaVersion"], 1)
        self.assertEqual(snapshot["trialId"], TRIAL_ID)
        self.assertEqual(snapshot["accountId"], "123456789012")
        self.assertEqual(snapshot["instance"]["id"], "i-0123456789abcdef0")
        self.assertEqual(snapshot["instance"]["ebsGiB"], 150)
        self.assertEqual(snapshot["bundleSha256"], None)
        self.assertEqual(snapshot["metrics"]["NetworkIn"]["periodSeconds"], 300)
        self.assertEqual(snapshot["metrics"]["StatusCheckFailed"]["periodSeconds"], 60)
        self.assertEqual(snapshot["metrics"]["NetworkIn"]["unit"], "Bytes")
        self.assertEqual(snapshot["metrics"]["NetworkIn"]["windowEndUtc"], "2026-09-24T12:00:00Z")
        self.assertNotIn("estimatedCost", json.dumps(snapshot))
        self.assertNotIn("actualCost", json.dumps(snapshot))
        self.assertTrue(any(call.args[:2] == ("cloudwatch", "get-metric-statistics") for call in calls.call_args_list))

    def test_missing_provenance_and_failed_aws_reads_remain_explicit(self):
        def unavailable(service, operation, *args):
            if service == "sts":
                raise OSError("credentials unavailable")
            if service == "cloudformation":
                raise OSError("stack absent")
            return {"Reservations": []}

        snapshot = self.trial.capture_snapshot(unavailable, self.config, TRIAL_ID, self.now)
        self.assertIsNone(snapshot["accountId"])
        self.assertIsNone(snapshot["stackStatus"])
        self.assertIsNone(snapshot["instance"])
        self.assertIsNone(snapshot["metrics"])
        self.assertEqual(set(snapshot["errors"]), {"identity", "stack"})

    def test_observations_append_without_overwriting_or_leaving_valid_partial_files(self):
        snapshot = self.trial.capture_snapshot(self.aws, self.config, TRIAL_ID, self.now)
        with tempfile.TemporaryDirectory() as directory:
            first = self.trial.append_observation(Path(directory), snapshot)
            second = self.trial.append_observation(Path(directory), snapshot)
            self.assertNotEqual(first, second)
            self.assertEqual(json.loads(first.read_text())["trialId"], TRIAL_ID)
            self.assertEqual(len(list(first.parent.glob("*.json"))), 2)
            self.assertFalse(list(first.parent.glob("*.tmp")))

    def test_billing_annotation_cannot_claim_account_window_as_trial_cost(self):
        details = {
            "now": self.now,
            "window_start": datetime(2026, 9, 24, 0, tzinfo=timezone.utc),
            "window_end": datetime(2026, 9, 25, 0, tzinfo=timezone.utc),
            "source": "AWS Billing daily export, UnblendedCost",
        }
        with self.assertRaises(ValueError):
            self.trial.make_billing_annotation(TRIAL_ID, "12.34", "USD", "account-window", "trial-cost", **details)
        annotation = self.trial.make_billing_annotation(TRIAL_ID, "12.34", "USD", "account-window", "unattributed", **details)
        self.assertEqual(annotation["amount"], "12.34")
        self.assertEqual(annotation["attribution"], "unattributed")
        self.assertEqual(annotation["windowStartUtc"], "2026-09-24T00:00:00Z")
        self.assertEqual(annotation["windowEndUtc"], "2026-09-25T00:00:00Z")
        with self.assertRaises(ValueError):
            self.trial.make_billing_annotation(TRIAL_ID, "12.34", "USD", "account-window", "unattributed", **{**details, "source": ""})

    def test_default_store_survives_checkout_cleanup(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"LOCALAPPDATA": directory, "XDG_DATA_HOME": directory}):
            store = self.trial.default_output_root()
        self.assertTrue(store.is_absolute())
        self.assertNotIn("app/out", store.as_posix())
        self.assertEqual(store.name, "trials")
