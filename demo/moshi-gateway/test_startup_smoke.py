import contextlib
import importlib.util
import io
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SMOKE = Path(__file__).with_name("startup_smoke.py")


class StartupSmokeTests(unittest.TestCase):
    def load_smoke(self):
        self.assertTrue(SMOKE.is_file())
        spec = importlib.util.spec_from_file_location("startup_smoke", SMOKE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_smoke_calls_production_preparation_with_placeholder_path(self):
        self.assertIn("prepare_interview_server(tracker)", SMOKE.read_text())
        smoke = self.load_smoke()
        observed = []

        def prepare(tracker):
            observed.append((os.environ["STARFOLIO_STT_MODEL_PATH"], tracker.cuda))

        worker = SimpleNamespace(prepare_interview_server=prepare)
        output = io.StringIO()
        with (
            patch.dict(sys.modules, {"interview_worker": worker}),
            patch.dict(os.environ, {"STARFOLIO_STT_MODEL_PATH": "real-model-path"}),
            contextlib.redirect_stdout(output),
        ):
            smoke.main()
        self.assertEqual(observed, [("/startup-smoke-no-model-load", None)])
        self.assertEqual(output.getvalue(), "STARTUP_BINDINGS_OK\n")

    def test_broken_production_preparation_fails_smoke(self):
        self.assertIn("prepare_interview_server(tracker)", SMOKE.read_text())
        smoke = self.load_smoke()

        def prepare(tracker):
            raise RuntimeError("binding broken")

        worker = SimpleNamespace(prepare_interview_server=prepare)
        output = io.StringIO()
        with (
            patch.dict(sys.modules, {"interview_worker": worker}),
            contextlib.redirect_stdout(output),
            self.assertRaisesRegex(RuntimeError, "binding broken"),
        ):
            smoke.main()
        self.assertEqual(output.getvalue(), "")

if __name__ == "__main__":
    unittest.main()
