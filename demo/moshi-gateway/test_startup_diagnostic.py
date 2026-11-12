import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import gpu_peaks
from gpu_sampler import GpuSampler

try:
    import aiohttp
except ImportError:
    sys.modules["aiohttp"] = SimpleNamespace(WSMsgType=SimpleNamespace(BINARY=2))

try:
    import numpy
except ImportError:
    sys.modules["numpy"] = SimpleNamespace(zeros=lambda size, dtype: [0] * size, float32=float)

import interview_worker


class StartupDiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.events = self.root / "events"
        self.sampler = GpuSampler(
            "trial-1", "s3://private/trials/trial-1/gpu/",
            spool_dir=self.root / "spool", event_dir=self.events,
        )

    def publish(self, error, stage="moshi_import"):
        path = gpu_peaks.publish_startup_diagnostic(
            stage, error, trial_id="trial-1", event_directory=self.events,
        )
        return path, json.loads(path.read_text())

    def test_missing_dependency_uses_only_fixed_numeric_codes(self):
        error = ModuleNotFoundError("private interview text", name="websockets")
        path, event = self.publish(error)
        self.assertEqual(path.name.split("-", 1)[0], "diagnostic")
        self.assertEqual(event["schema_version"], 3)
        self.assertEqual(event["event_type"], "startup_diagnostic")
        self.assertEqual(event["operation_stage"], 1)
        self.assertEqual(event["failure_category"], 1)
        self.assertEqual(event["dependency_id"], 1)
        self.assertNotIn("private interview text", path.read_text())
        self.assertNotIn("websockets", path.read_text())
        self.assertEqual(list(self.events.glob("*.tmp")), [])
        self.assertEqual(self.sampler.valid_event(event), event)

    def test_unlisted_dependency_uses_unknown_id(self):
        _, event = self.publish(ModuleNotFoundError("private", name="candidate_private_name"))
        self.assertEqual(event["failure_category"], 1)
        self.assertEqual(event["dependency_id"], 0)
        self.assertNotIn("candidate_private_name", json.dumps(event))

    def test_non_dependency_failure_cannot_claim_dependency(self):
        _, event = self.publish(PermissionError("/private/interview.wav"), "server_main")
        self.assertEqual(event["operation_stage"], 4)
        self.assertEqual(event["failure_category"], 3)
        self.assertEqual(event["dependency_id"], 0)
        self.assertNotIn("interview.wav", json.dumps(event))

    def test_sampler_keeps_valid_event_and_rejects_private_or_wrong_codes(self):
        path, event = self.publish(RuntimeError("private interview text"))
        self.assertEqual([item[1] for item in self.sampler.read_events()], [event])
        for change in (
            {"traceback": "private interview text"},
            {"operation_stage": "moshi_import"},
            {"operation_stage": 0},
            {"failure_category": 999},
            {"failure_category": 0},
            {"dependency_id": 1},
            {"schema_version": True},
        ):
            path.write_text(json.dumps(event | change))
            self.assertEqual(self.sampler.read_events(), [])
            self.assertEqual(self.sampler.event_file_counts()["malformed"], 1)
        path.write_text(json.dumps(event))
        segment = self.sampler.flush()
        self.assertEqual(json.loads(segment.read_text())["events"], [event])

    def test_diagnostic_publish_failure_preserves_original_exception(self):
        original = ValueError("private original")
        with patch("interview_worker.publish_startup_diagnostic", side_effect=OSError("disk full")):
            with self.assertRaises(ValueError) as raised:
                with interview_worker.diagnose_startup("moshi_import"):
                    raise original
        self.assertIs(raised.exception, original)

    def test_main_captures_import_failure_before_model_load(self):
        with patch.dict(os.environ, {
            "STARFOLIO_TRIAL_ID": "trial-1",
            "STARFOLIO_GPU_EVENT_DIR": str(self.events),
        }), patch.dict(sys.modules, {"moshi": None}):
            with self.assertRaises(ModuleNotFoundError):
                interview_worker.main()
        diagnostics = [event for _, event in self.sampler.read_events() if event["event_type"] == "startup_diagnostic"]
        self.assertEqual(len(diagnostics), 1)
        self.assertEqual(diagnostics[0]["operation_stage"], 1)
        self.assertEqual(diagnostics[0]["failure_category"], 1)


if __name__ == "__main__":
    unittest.main()
