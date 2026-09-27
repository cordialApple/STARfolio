import json
import hashlib
import tempfile
import threading
import time
import unittest
from pathlib import Path

from gpu_sampler import GpuSampler


class Result:
    def __init__(self, stdout="", returncode=0):
        self.stdout = stdout
        self.returncode = returncode


class Commands:
    def __init__(self):
        self.calls = []
        self.upload_failures = 0

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        if args[0] == "nvidia-smi" and args[1].startswith("--query-gpu="):
            return Result("GPU-a, 49140, 1000, 48140, 42\n")
        if args[0] == "nvidia-smi":
            return Result("GPU-a, 123, 700\n")
        if args[:3] == ["aws", "s3", "cp"]:
            if self.upload_failures:
                self.upload_failures -= 1
                return Result(returncode=1)
            return Result()
        raise AssertionError(args)


class GpuSamplerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.commands = Commands()
        self.now = 10.0
        self.sampler = GpuSampler(
            trial_id="trial-1",
            destination_uri="s3://private/trials/trial-1/gpu/",
            spool_dir=self.root / "spool",
            event_dir=self.root / "events",
            owner_dir=self.root / "owners",
            proc_root=self.root / "proc",
            command=self.commands,
            monotonic=lambda: self.now,
            utc=lambda: "2026-09-27T00:00:00Z",
        )

    def publish_peak(self, name="a.json"):
        event = {
            "schema_version": 1,
            "event_type": "pytorch_peak",
            "trial_id": "trial-1",
            "timestamp_utc": "2026-09-27T00:00:00+00:00",
            "monotonic_ns": 100,
            "pid": 123,
            "process_start_ticks": 777,
            "role": "interview",
            "phase": "active",
            "status": "sample",
            "allocated_bytes": 1,
            "reserved_bytes": 2,
            "max_allocated_bytes": 3,
            "max_reserved_bytes": 4,
            "phase_max_allocated_bytes": 3,
            "phase_max_reserved_bytes": 4,
            "oom": False,
        }
        path = self.sampler.event_dir / name
        path.write_text(json.dumps(event))
        return path, event

    def test_sample_has_device_process_interval_and_unknown_role(self):
        self.sampler.sample_once()
        self.now = 10.25
        self.sampler.sample_once()
        first, second = self.sampler.records
        self.assertEqual(first["device_total_mib"], 49140)
        self.assertEqual(first["device_used_mib"], 1000)
        self.assertEqual(first["device_free_mib"], 48140)
        self.assertEqual(first["device_utilization_percent"], 42)
        self.assertEqual(first["processes"][0]["used_mib"], 700)
        self.assertIsNone(first["processes"][0]["role"])
        self.assertIsNone(first["actual_interval_ms"])
        self.assertEqual(second["actual_interval_ms"], 250)
        self.assertEqual(second["monotonic_ns"], 10250000000)
        self.assertEqual(second["utc"], "2026-09-27T00:00:00Z")

    def test_role_requires_matching_pid_and_start_identity(self):
        proc = self.root / "proc" / "123"
        proc.mkdir(parents=True)
        (proc / "stat").write_text("123 (worker) S " + "0 " * 18 + "777 0\n")
        self.sampler.owner_dir.mkdir()
        (self.sampler.owner_dir / "123.json").write_text(
            json.dumps({"pid": 123, "process_start_ticks": 778, "role": "interview"})
        )
        self.sampler.sample_once()
        self.assertIsNone(self.sampler.records[-1]["processes"][0]["role"])
        (self.sampler.owner_dir / "123.json").write_text(
            json.dumps({"pid": 123, "process_start_ticks": 777, "role": "interview"})
        )
        self.sampler.sample_once()
        self.assertEqual(self.sampler.records[-1]["processes"][0]["role"], "interview")
        self.assertEqual(
            self.sampler.records[-1]["processes"][0]["process_start_ticks"], 777
        )

    def test_absent_gpu_values_are_null(self):
        self.commands = lambda args, **kwargs: Result("N/A, N/A, N/A, N/A, N/A\n")
        self.sampler.command = self.commands
        self.sampler.sample_once()
        sample = self.sampler.records[-1]
        self.assertIsNone(sample["device_total_mib"])
        self.assertIsNone(sample["device_utilization_percent"])
        self.assertEqual(sample["processes"], [])

    def test_flush_writes_complete_immutable_segment_and_ignores_partial_event(self):
        self.sampler.sample_once()
        (self.sampler.event_dir / "writing.tmp").write_text('{"event_type":')
        segment = self.sampler.flush()
        self.assertTrue(segment.is_file())
        self.assertFalse(list(self.sampler.spool_dir.glob("*.tmp")))
        data = json.loads(segment.read_text())
        self.assertEqual(len(data["samples"]), 1)
        self.assertEqual(data["events"], [])
        self.assertEqual(data["trial_id"], "trial-1")
        self.assertEqual(self.sampler.flush(), None)

    def test_concurrent_event_ingested_after_atomic_publication(self):
        _, event = self.publish_peak()
        (self.sampler.event_dir / "a.json").unlink()
        partial = self.sampler.event_dir / "a.tmp"
        partial.write_text(json.dumps(event))
        checkpoint = self.sampler.flush()
        self.assertEqual(json.loads(checkpoint.read_text())["event_file_counts"], {"malformed": 0, "partial": 1})
        self.assertEqual(json.loads(checkpoint.read_text())["events"], [])
        published = self.sampler.event_dir / "a.json"
        partial.replace(published)
        segment = self.sampler.flush()
        self.assertEqual(json.loads(segment.read_text())["events"], [event])
        self.assertTrue(published.exists())
        self.assertIsNone(self.sampler.flush())

    def test_failed_upload_keeps_segment_and_event_then_retry_receipts(self):
        event, _ = self.publish_peak()
        self.sampler.sample_once()
        segment = self.sampler.flush()
        self.commands.upload_failures = 1
        self.sampler.upload_pending()
        self.assertTrue(segment.exists())
        self.assertTrue(event.exists())
        self.assertFalse(list(self.sampler.spool_dir.glob("*.uploaded")))
        self.sampler.upload_pending()
        self.assertFalse(segment.exists())
        self.assertFalse(event.exists())
        self.assertEqual(len(list(self.sampler.spool_dir.glob("*.uploaded"))), 1)
        uploads = [call for call in self.commands.calls if call[:3] == ["aws", "s3", "cp"]]
        self.assertEqual(len(uploads), 2)
        self.assertIn("--sse", uploads[-1])
        self.assertIn("AES256", uploads[-1])
        self.assertTrue(uploads[-1][4].startswith("s3://private/trials/trial-1/gpu/"))

    def test_receipt_recovery_cleans_claimed_event_without_second_upload(self):
        event, _ = self.publish_peak()
        segment = self.sampler.flush()
        body = json.loads(segment.read_text())
        segment.with_suffix(".uploaded").write_text(json.dumps({
            "s3_uri": self.sampler.destination_uri + segment.name,
            "sha256": hashlib.sha256(segment.read_bytes()).hexdigest(),
            "sample_count": len(body["samples"]),
            "event_count": len(body["events"]),
            "uploaded_utc": "2026-09-27T00:00:00Z",
        }))
        self.sampler.upload_pending()
        self.assertFalse(event.exists())
        self.assertFalse(segment.exists())
        self.assertFalse([c for c in self.commands.calls if c[:3] == ["aws", "s3", "cp"]])

    def test_invalid_receipt_cannot_acknowledge_unuploaded_segment(self):
        event, _ = self.publish_peak()
        segment = self.sampler.flush()
        segment.with_suffix(".uploaded").write_text("{}")
        self.commands.upload_failures = 1
        self.sampler.upload_pending()
        self.assertTrue(segment.exists())
        self.assertTrue(event.exists())
        self.assertEqual(len([c for c in self.commands.calls if c[:3] == ["aws", "s3", "cp"]]), 1)

    def test_segment_with_extra_private_field_never_uploads(self):
        self.sampler.sample_once()
        segment = self.sampler.flush()
        body = json.loads(segment.read_text())
        body["prompt"] = "private prompt"
        segment.write_text(json.dumps(body))
        self.sampler.upload_pending()
        self.assertTrue(segment.exists())
        self.assertFalse([c for c in self.commands.calls if c[:3] == ["aws", "s3", "cp"]])

    def test_nested_private_field_and_invalid_value_never_upload(self):
        self.sampler.sample_once()
        segment = self.sampler.flush()
        body = json.loads(segment.read_text())
        body["samples"][0]["processes"][0]["prompt"] = "private prompt"
        segment.write_text(json.dumps(body))
        self.sampler.upload_pending()
        self.assertFalse([c for c in self.commands.calls if c[:3] == ["aws", "s3", "cp"]])
        del body["samples"][0]["processes"][0]["prompt"]
        body["samples"][0]["gpu_uuid"] = {"audio": "private audio"}
        segment.write_text(json.dumps(body))
        self.sampler.upload_pending()
        self.assertFalse([c for c in self.commands.calls if c[:3] == ["aws", "s3", "cp"]])

    def test_corrupt_segment_cannot_claim_unuploaded_event(self):
        event, raw = self.publish_peak()
        self.sampler.flush()
        segment = next(self.sampler.spool_dir.glob("segment-*.json"))
        body = json.loads(segment.read_text())
        body["events"][0]["prompt"] = "private prompt"
        segment.write_text(json.dumps(body))
        self.assertEqual(self.sampler.read_events(), [(event, raw)])

    def test_uploaded_peak_keeps_safe_role_provenance(self):
        proc = self.root / "proc" / "123"
        proc.mkdir(parents=True)
        (proc / "stat").write_text("123 (worker) S " + "0 " * 18 + "777 0\n")
        self.publish_peak()
        self.sampler.flush()
        self.sampler.upload_pending()
        self.sampler.sample_once()
        self.assertEqual(self.sampler.records[-1]["processes"][0]["role"], "interview")

    def test_pending_peak_keeps_safe_role_provenance(self):
        proc = self.root / "proc" / "123"
        proc.mkdir(parents=True)
        (proc / "stat").write_text("123 (worker) S " + "0 " * 18 + "777 0\n")
        self.publish_peak()
        self.sampler.flush()
        self.sampler.sample_once()
        self.assertEqual(self.sampler.records[-1]["processes"][0]["role"], "interview")

    def test_malformed_event_never_enters_segment(self):
        event, _ = self.publish_peak()
        raw = json.loads(event.read_text())
        raw["prompt"] = "private text"
        event.write_text(json.dumps(raw))
        self.sampler.sample_once()
        segment = self.sampler.flush()
        self.assertEqual(json.loads(segment.read_text())["events"], [])
        self.assertNotIn("private text", segment.read_text())
        self.assertTrue(event.exists())

    def test_malformed_and_partial_peak_files_get_safe_checkpoint(self):
        (self.sampler.event_dir / "private.json").write_text('{"prompt":"private prompt"}')
        (self.sampler.event_dir / "private.tmp").write_text("private audio")
        segment = self.sampler.flush()
        self.assertIsNotNone(segment)
        body = json.loads(segment.read_text())
        self.assertEqual(body["event_file_counts"], {"malformed": 1, "partial": 1})
        self.assertNotIn("private prompt", segment.read_text())
        self.assertNotIn("private audio", segment.read_text())
        self.assertIsNone(self.sampler.flush())
        self.sampler.upload_pending()
        self.assertFalse(segment.exists())

    def test_untrusted_event_and_owner_shapes_cannot_stop_sampling(self):
        event, _ = self.publish_peak()
        raw = json.loads(event.read_text())
        raw["role"] = ["interview"]
        event.write_text(json.dumps(raw))
        proc = self.root / "proc" / "123"
        proc.mkdir(parents=True)
        (proc / "stat").write_text("123 (worker) S " + "0 " * 18 + "777 0\n")
        self.sampler.owner_dir.mkdir()
        (self.sampler.owner_dir / "123.json").write_text("[]")
        self.sampler.sample_once()
        self.assertIsNone(self.sampler.records[-1]["processes"][0]["role"])
        (self.sampler.owner_dir / "123.json").write_text(json.dumps({
            "pid": 123,
            "process_start_ticks": 777,
            "role": ["interview"],
        }))
        self.sampler.sample_once()
        self.assertIsNone(self.sampler.records[-1]["processes"][0]["role"])

    def test_device_uuid_rejects_unstructured_output(self):
        def unexpected(args, **kwargs):
            if args[1].startswith("--query-gpu="):
                return Result("GPU-private prompt, 49140, 1000, 48140, 42\n")
            return Result()

        self.sampler.command = unexpected
        self.sampler.sample_once()
        self.assertIsNone(self.sampler.records[-1]["gpu_uuid"])

    def test_shutdown_flushes_last_sample_and_uploads(self):
        class Stop:
            def __init__(self):
                self.waits = 0

            def is_set(self):
                return self.waits > 0

            def wait(self, duration):
                self.waits += 1
                return True

        self.sampler.run(Stop())
        self.assertEqual(len(list(self.sampler.spool_dir.glob("*.uploaded"))), 1)
        self.assertEqual(len([c for c in self.commands.calls if c[0] == "nvidia-smi"]), 2)

    def test_event_published_during_shutdown_upload_gets_checkpoint(self):
        original = self.commands
        published = False

        def command(args, **kwargs):
            nonlocal published
            if args[:3] == ["aws", "s3", "cp"] and not published:
                published = True
                self.publish_peak()
            return original(args, **kwargs)

        class Stop:
            def __init__(self):
                self.waits = 0

            def is_set(self):
                return self.waits > 0

            def wait(self, duration):
                self.waits += 1
                return True

        self.sampler.command = command
        self.sampler.run(Stop())
        self.assertEqual(len(list(self.sampler.spool_dir.glob("*.uploaded"))), 2)
        self.assertFalse(list(self.sampler.event_dir.glob("*.json")))

    def test_sample_wait_accounts_for_query_time(self):
        original = self.commands

        def slow_command(args, **kwargs):
            if args[0] == "nvidia-smi":
                self.now += 0.1
            return original(args, **kwargs)

        class Stop:
            def __init__(self):
                self.waited = None

            def is_set(self):
                return self.waited is not None

            def wait(self, duration):
                self.waited = duration
                return True

        self.sampler.command = slow_command
        stop = Stop()
        self.sampler.run(stop)
        self.assertAlmostEqual(stop.waited, 0.05)

    def test_slow_upload_does_not_block_sampling(self):
        blocked = threading.Event()
        release = threading.Event()
        original = self.commands

        def slow_upload(args, **kwargs):
            if args[:3] == ["aws", "s3", "cp"]:
                blocked.set()
                release.wait(2)
            return original(args, **kwargs)

        class Stop:
            def __init__(self, test):
                self.test = test
                self.waits = 0

            def is_set(self):
                return self.waits >= 3

            def wait(self, duration):
                self.waits += 1
                self.test.now += 0.25
                time.sleep(0.02)
                return self.is_set()

        self.sampler.command = slow_upload
        self.sampler.upload_interval = 0.1
        worker = threading.Thread(target=self.sampler.run, args=(Stop(self),))
        worker.start()
        try:
            self.assertTrue(blocked.wait(1))
            time.sleep(0.08)
            query_count = len(
                [
                    call
                    for call in self.commands.calls
                    if call[0] == "nvidia-smi" and call[1].startswith("--query-gpu=")
                ]
            )
            self.assertGreaterEqual(query_count, 3)
        finally:
            release.set()
            worker.join(2)
        self.assertFalse(worker.is_alive())


if __name__ == "__main__":
    unittest.main()
