import json
import io
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from contextlib import redirect_stderr
from unittest.mock import patch

from gpu_peaks import PeakTracker, process_start_ticks, publish_startup_status

try:
    import aiohttp
except ImportError:
    sys.modules["aiohttp"] = SimpleNamespace(WSMsgType=SimpleNamespace(BINARY=2))

try:
    import numpy
except ImportError:
    sys.modules["numpy"] = SimpleNamespace(zeros=lambda size, dtype: [0] * size, float32=float)

from interview_worker import create_channel, track_interview_lifecycle
from conditioner_worker import track_conditioner_lifecycle


def read_events(directory):
    return [json.loads(path.read_text()) for path in Path(directory).glob("*.json")]


class FakeCuda:
    def __init__(self, available=True):
        self.available = available
        self.allocated = 0
        self.reserved = 0
        self.max_allocated = 0
        self.max_reserved = 0
        self.resets = 0

    def is_available(self):
        return self.available

    def memory_allocated(self):
        return self.allocated

    def memory_reserved(self):
        return self.reserved

    def max_memory_allocated(self):
        return self.max_allocated

    def max_memory_reserved(self):
        return self.max_reserved

    def reset_peak_memory_stats(self):
        self.resets += 1
        self.max_allocated = self.allocated
        self.max_reserved = self.reserved


class PeakTrackerTests(unittest.TestCase):
    def test_startup_status_publishes_allowlisted_numeric_event(self):
        with tempfile.TemporaryDirectory() as directory:
            first = publish_startup_status(
                "child_exit", "conditioner", 123, 137, "child_signal",
                trial_id="trial-1", event_directory=directory,
            )
            second = publish_startup_status(
                "child_exit", "conditioner", 123, 137, "child_signal",
                trial_id="trial-1", event_directory=directory,
            )
            self.assertNotEqual(first, second)
            event = json.loads(first.read_text())
            self.assertEqual(event["schema_version"], 2)
            self.assertEqual(event["event_type"], "startup_status")
            self.assertEqual(event["role"], "status_publisher")
            self.assertEqual(event["pid"], os.getpid())
            self.assertEqual(event["startup_stage"], 5)
            self.assertEqual(event["child_role"], "conditioner")
            self.assertEqual(event["child_pid"], 123)
            self.assertEqual(event["exit_code"], 137)
            self.assertEqual(event["failure_category"], 2)
            self.assertIs(type(event["startup_stage"]), int)
            self.assertIs(type(event["failure_category"]), int)
            self.assertNotIn("child_signal", first.read_text())
            self.assertNotIn("error", event)
            self.assertFalse(list(Path(directory).glob("*.tmp")))

    def test_shutdown_reason_is_numeric_and_fixed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = publish_startup_status(
                "shutdown", shutdown_reason="sigterm",
                trial_id="trial-1", event_directory=directory,
            )
            event = json.loads(path.read_text())
            self.assertEqual(event["shutdown_reason"], 1)
            self.assertNotIn("sigterm", path.read_text())

    def test_tokenizer_smoke_failure_has_fixed_numeric_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            path = publish_startup_status(
                "tokenizer_smoke_failed", trial_id="trial-1", event_directory=directory,
            )
            event = json.loads(path.read_text())
            self.assertEqual(event["startup_stage"], 7)
            self.assertNotIn("tokenizer_smoke_failed", path.read_text())

    def test_startup_status_rejects_unlisted_or_inconsistent_values(self):
        with tempfile.TemporaryDirectory() as directory:
            cases = [
                ("private prompt", None, None, None, None),
                ("child_exit", "conditioner", 123, 1, "private failure"),
                ("child_exit", "conditioner", 123, True, "child_nonzero"),
                ("child_exit", "conditioner", 123, 0, "child_nonzero"),
                ("gateway_spawned", "gateway", 123, 1, "child_nonzero"),
            ]
            for stage, role, pid, code, category in cases:
                with self.subTest(stage=stage, category=category):
                    with self.assertRaises(ValueError):
                        publish_startup_status(
                            stage, role, pid, code, category,
                            trial_id="trial-1", event_directory=directory,
                        )
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_default_event_directory_reads_runtime_ram_inbox(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"STARFOLIO_GPU_EVENT_DIR": directory}):
                tracker = PeakTracker("interview", "trial-1", cuda=FakeCuda(False))
            self.assertEqual(tracker.event_directory, Path(directory))

    def test_published_event_is_group_readable_for_sampler(self):
        chmod = os.chmod
        modes = []

        def capture_mode(path, mode):
            modes.append((Path(path), mode))
            chmod(path, mode)

        with tempfile.TemporaryDirectory() as directory:
            with patch("gpu_peaks.os.chmod", side_effect=capture_mode):
                with PeakTracker("interview", "trial-1", directory, cuda=FakeCuda(False), interval=60):
                    pass
            events = list(Path(directory).glob("*.json"))
            self.assertTrue(events)
            self.assertEqual({mode for path, mode in modes if path.suffix == ".tmp"}, {0o640})
            if sys.platform.startswith("linux"):
                self.assertTrue(all(stat.S_IMODE(path.stat().st_mode) == 0o640 for path in events))

    def test_phase_and_total_peaks_survive_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            cuda = FakeCuda()
            with PeakTracker("interview", "trial-1", directory, cuda=cuda, interval=60) as tracker:
                cuda.allocated, cuda.reserved = 40, 60
                cuda.max_allocated, cuda.max_reserved = 100, 140
                tracker.set_phase("model_load")
                cuda.allocated, cuda.reserved = 20, 30
                cuda.max_allocated, cuda.max_reserved = 75, 90
                tracker.publish("sample")
            events = read_events(directory)
            load_event = next(event for event in events if event["phase"] == "model_load")
            self.assertEqual(load_event["phase_max_allocated_bytes"], 75)
            self.assertEqual(load_event["max_allocated_bytes"], 100)
            self.assertEqual(load_event["allocated_bytes"], 20)
            self.assertEqual(load_event["reserved_bytes"], 30)
            self.assertEqual(cuda.resets, 1)

    def test_cuda_absent_publishes_null_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            with PeakTracker("conditioner", "trial-1", directory, cuda=FakeCuda(False), interval=60):
                pass
            events = read_events(directory)
            self.assertTrue(events)
            self.assertTrue(all(event["allocated_bytes"] is None for event in events))
            self.assertTrue(all(event["max_reserved_bytes"] is None for event in events))

    def test_oom_keeps_original_exception_and_publishes_numeric_event(self):
        class OutOfMemoryError(RuntimeError):
            pass

        with tempfile.TemporaryDirectory() as directory:
            cuda = FakeCuda()
            cuda.OutOfMemoryError = OutOfMemoryError
            error = OutOfMemoryError("secret input")
            with self.assertRaises(OutOfMemoryError) as raised:
                with PeakTracker("interview", "trial-1", directory, cuda=cuda, interval=60):
                    raise error
            self.assertIs(raised.exception, error)
            events = read_events(directory)
            failure = next(event for event in events if event["status"] == "failure")
            self.assertTrue(failure["oom"])
            self.assertEqual(failure["role"], "interview")
            self.assertEqual(failure["trial_id"], "trial-1")
            self.assertIn("pid", failure)
            self.assertIn("process_start_ticks", failure)
            self.assertIn("timestamp_utc", failure)
            self.assertIn("monotonic_ns", failure)
            self.assertNotIn("secret input", json.dumps(events))
            self.assertFalse(list(Path(directory).glob("*.tmp")))

    def test_caught_oom_can_be_recorded_before_http_handler_converts_it(self):
        class OutOfMemoryError(RuntimeError):
            pass

        with tempfile.TemporaryDirectory() as directory:
            cuda = FakeCuda()
            cuda.OutOfMemoryError = OutOfMemoryError
            with PeakTracker("conditioner", "trial-1", directory, cuda=cuda, interval=60) as tracker:
                tracker.record_failure(OutOfMemoryError("private input"))
            events = read_events(directory)
            self.assertTrue(any(event["status"] == "failure" and event["oom"] for event in events))
            self.assertNotIn("private input", json.dumps(events))

    def test_telemetry_failure_does_not_replace_model_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            model_error = RuntimeError("model failed")
            with redirect_stderr(io.StringIO()):
                with self.assertRaises(RuntimeError) as raised:
                    with PeakTracker("interview", "trial-1", directory, cuda=FakeCuda(), interval=60) as tracker:
                        tracker.publish = lambda *args: (_ for _ in ()).throw(MemoryError())
                        raise model_error
            self.assertIs(raised.exception, model_error)

    def test_publish_failure_reports_safe_diagnostic_once(self):
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            with redirect_stderr(output):
                with PeakTracker("interview", "trial-1", directory, cuda=FakeCuda(), interval=60) as tracker:
                    tracker.publish = lambda *args: (_ for _ in ()).throw(OSError("private prompt"))
                    tracker.record_failure(RuntimeError("private audio"))
            self.assertIn("GPU peak telemetry publish failed", output.getvalue())
            self.assertEqual(output.getvalue().count("GPU peak telemetry publish failed"), 1)
            self.assertNotIn("private prompt", output.getvalue())
            self.assertNotIn("private audio", output.getvalue())

    def test_linux_process_start_ticks_handles_parentheses_in_name(self):
        with tempfile.TemporaryDirectory() as directory:
            stat = Path(directory) / "stat"
            stat.write_text("123 (worker (main)) S " + " ".join(str(i) for i in range(4, 53)))
            self.assertEqual(process_start_ticks(stat), 22)

    def test_interview_server_marks_load_warmup_and_serving(self):
        phases = []

        class Tracker:
            def set_phase(self, phase):
                phases.append(phase)

        class State:
            def warmup(self):
                phases.append("native_warmup")

        class Server:
            ServerState = State

            @staticmethod
            def load_models(args):
                phases.append("native_load")
                return "models"

        server = Server()
        track_interview_lifecycle(server, Tracker())
        self.assertEqual(server.load_models(None), "models")
        State().warmup()
        self.assertEqual(
            phases,
            ["model_load", "native_load", "warmup", "native_warmup", "serving"],
        )

    def test_failed_warmup_stays_in_warmup_phase(self):
        phases = []

        class Tracker:
            def set_phase(self, phase):
                phases.append(phase)

        class State:
            def warmup(self):
                raise RuntimeError("warmup failed")

        class Server:
            ServerState = State
            load_models = staticmethod(lambda args: None)

        track_interview_lifecycle(Server, Tracker())
        with self.assertRaisesRegex(RuntimeError, "warmup failed"):
            State().warmup()
        self.assertEqual(phases, ["warmup"])

    def test_conditioner_marks_load_and_each_encode(self):
        phases = []

        class Tracker:
            def set_phase(self, phase):
                phases.append(phase)

        class Service:
            def __init__(self):
                phases.append("native_init")

            def encode(self, text):
                phases.append("native_encode")
                return 7

        class Server:
            EncoderService = Service

        track_conditioner_lifecycle(Server, Tracker())
        service = Service()
        self.assertEqual(service.encode("private prompt"), 7)
        self.assertEqual(
            phases,
            ["model_load", "native_init", "serving", "session_active", "native_encode", "serving"],
        )

    def test_conditioner_records_caught_encode_failure(self):
        class OutOfMemoryError(RuntimeError):
            pass

        error = OutOfMemoryError("private input")
        failures = []

        class Tracker:
            def set_phase(self, phase):
                pass

            def record_failure(self, exception):
                failures.append(exception)

        class Service:
            def __init__(self):
                pass

            def encode(self, text):
                raise error

        class Server:
            EncoderService = Service

        track_conditioner_lifecycle(Server, Tracker())
        with self.assertRaises(OutOfMemoryError) as raised:
            Service().encode("private input")
        self.assertIs(raised.exception, error)
        self.assertEqual(failures, [error])

    def test_failed_conditioner_init_stays_in_model_load_phase(self):
        phases = []

        class Tracker:
            def set_phase(self, phase):
                phases.append(phase)

        class Service:
            def __init__(self):
                raise RuntimeError("load failed")

            def encode(self, text):
                return None

        class Server:
            EncoderService = Service

        track_conditioner_lifecycle(Server, Tracker())
        with self.assertRaisesRegex(RuntimeError, "load failed"):
            Service()
        self.assertEqual(phases, ["model_load"])


class InterviewChannelPhaseTests(unittest.IsolatedAsyncioTestCase):
    async def test_channel_marks_session_init_and_active(self):
        phases = []

        class Tracker:
            def set_phase(self, phase):
                phases.append(phase)

        class Base:
            def __init__(self, server, ws, mimi=None):
                raise RuntimeError("native init")

        async def encode(**kwargs):
            return None

        Channel = create_channel(Base, object, encode, tracker=Tracker())
        with self.assertRaisesRegex(RuntimeError, "native init"):
            Channel(None, None)
        self.assertEqual(phases, ["session_init"])


if __name__ == "__main__":
    unittest.main()
