import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

MODULE = Path(__file__).with_name("gpu_summary.py")
TRIAL_ID = "19ab818e-2f38-4e71-9b51-84698a30f10d"
GPU = "GPU-a600ae91-a383-6b8a-1430-c474b2402692"
MIB = 2**20


def make_sample(second, used, interval=250, utilization=0, processes=()):
    return {
        "schema_version": 1,
        "trial_id": TRIAL_ID,
        "utc": f"2026-10-09T19:40:{second:02d}.000Z",
        "monotonic_ns": second * 1_000_000_000,
        "actual_interval_ms": interval,
        "gpu_uuid": GPU,
        "device_total_mib": 46068,
        "device_used_mib": used,
        "device_free_mib": None if used is None else 46068 - used,
        "device_utilization_percent": utilization,
        "processes": list(processes),
    }


def make_process(pid, used, role="conditioner"):
    return {"gpu_uuid": GPU, "pid": pid, "process_start_ticks": pid * 10, "used_mib": used, "role": role}


def make_peak(second, pid, phase, status, allocated, role="conditioner", oom=False):
    return {
        "schema_version": 1,
        "event_type": "pytorch_peak",
        "trial_id": TRIAL_ID,
        "timestamp_utc": f"2026-10-09T19:40:{second:02d}.000000+00:00",
        "monotonic_ns": second * 1_000_000_000,
        "pid": pid,
        "process_start_ticks": pid * 10,
        "role": role,
        "phase": phase,
        "status": status,
        "oom": oom,
        "allocated_bytes": allocated,
        "reserved_bytes": allocated,
        "phase_max_allocated_bytes": allocated,
        "phase_max_reserved_bytes": None if allocated is None else allocated + MIB,
        "max_allocated_bytes": allocated,
        "max_reserved_bytes": None if allocated is None else allocated + MIB,
    }


class GpuSummaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("gpu_summary", MODULE)
        cls.gpu_summary = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.gpu_summary)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.segment_number = 0

    def write_segment(self, samples=(), events=(), trial_id=TRIAL_ID):
        self.segment_number += 1
        segment_id = f"{self.segment_number:032x}"
        body = {
            "schema_version": 1,
            "trial_id": trial_id,
            "segment_id": segment_id,
            "created_utc": "2026-10-09T19:40:00.000Z",
            "samples": list(samples),
            "events": list(events),
            "event_files": [f"peak-{index}.json" for index, _ in enumerate(events)],
        }
        (self.directory / f"segment-{segment_id}.json").write_text(json.dumps(body))

    def test_reports_device_process_and_phase_peaks_across_segments(self):
        self.write_segment(
            samples=[
                make_sample(3, 23665, utilization=100, processes=[make_process(7, 23656)]),
                make_sample(4, 12000, utilization=40, processes=[make_process(7, 11990)]),
            ],
            events=[
                make_peak(3, 7, "model_load", "sample", 23153 * MIB),
                make_peak(4, 7, "serving", "sample", 11608 * MIB),
            ],
        )
        self.write_segment(
            samples=[make_sample(1, 0, interval=None), make_sample(2, 560, processes=[make_process(7, 560)])],
            events=[make_peak(1, 7, "startup", "start", 0), make_peak(2, 7, "model_load", "sample", 64 * MIB)],
        )

        summary = self.gpu_summary.summarize_trial(self.directory)

        self.assertEqual(summary["trial_id"], TRIAL_ID)
        self.assertEqual((summary["segment_count"], summary["skipped_segment_count"]), (2, 0))
        self.assertEqual(summary["sample_count"], 4)
        self.assertEqual(summary["first_sample_utc"], "2026-10-09T19:40:01.000Z")
        self.assertEqual(summary["last_sample_utc"], "2026-10-09T19:40:04.000Z")
        self.assertEqual(summary["span_seconds"], 3.0)
        self.assertEqual(
            summary["devices"],
            [
                {
                    "gpu_uuid": GPU,
                    "total_mib": 46068,
                    "peak_used_mib": 23665,
                    "peak_used_utc": "2026-10-09T19:40:03.000Z",
                    "peak_utilization_percent": 100,
                }
            ],
        )
        self.assertEqual(
            summary["processes"],
            [{"role": "conditioner", "pid": 7, "process_start_ticks": 70, "sample_count": 3, "peak_used_mib": 23656}],
        )
        worker = summary["pytorch"][0]
        self.assertEqual(summary["pytorch_event_count"], 4)
        self.assertEqual(worker["max_allocated_bytes"], 23153 * MIB)
        self.assertEqual(worker["max_reserved_bytes"], 23154 * MIB)
        self.assertEqual((worker["oom"], worker["failed"], worker["exited"]), (False, False, False))
        self.assertEqual(
            [(phase["phase"], phase["peak_allocated_bytes"]) for phase in worker["phases"]],
            [("startup", 0), ("model_load", 23153 * MIB), ("serving", 11608 * MIB)],
        )
        self.assertEqual(worker["phases"][1]["first_utc"], "2026-10-09T19:40:02.000000+00:00")
        self.assertEqual(worker["phases"][1]["last_utc"], "2026-10-09T19:40:03.000000+00:00")

    def test_reports_sampling_cadence_and_gaps(self):
        self.write_segment(
            samples=[make_sample(1, 0, interval=None)]
            + [make_sample(second, 0) for second in range(2, 21)]
            + [make_sample(21, 0, interval=3526)]
        )

        summary = self.gpu_summary.summarize_trial(self.directory)

        self.assertEqual(summary["interval_ms"]["median"], 250)
        self.assertEqual(summary["interval_ms"]["max"], 3526)
        self.assertLess(summary["interval_ms"]["p95"], 3526)
        self.assertEqual(summary["gap_count"], 1)

    def test_keeps_absent_values_null(self):
        self.write_segment(
            samples=[make_sample(1, None, interval=None, utilization=None, processes=[make_process(7, None)])],
            events=[make_peak(1, 7, "startup", "start", None)],
        )

        summary = self.gpu_summary.summarize_trial(self.directory)

        self.assertEqual(summary["interval_ms"], {"median": None, "p95": None, "max": None})
        self.assertIsNone(summary["gap_count"])
        self.assertIsNone(summary["devices"][0]["peak_used_mib"])
        self.assertIsNone(summary["devices"][0]["peak_used_utc"])
        self.assertIsNone(summary["devices"][0]["peak_utilization_percent"])
        self.assertIsNone(summary["processes"][0]["peak_used_mib"])
        self.assertIsNone(summary["pytorch"][0]["max_allocated_bytes"])
        self.assertIsNone(summary["pytorch"][0]["phases"][0]["peak_reserved_bytes"])

    def test_separates_workers_and_flags_oom_and_failure(self):
        self.write_segment(
            events=[
                make_peak(1, 7, "model_load", "sample", 40000 * MIB),
                make_peak(2, 7, "model_load", "failure", 44000 * MIB, oom=True),
                make_peak(3, 7, "model_load", "exit", 0),
                make_peak(2, 9, "startup", "failure", 0, role="interview"),
            ],
        )

        summary = self.gpu_summary.summarize_trial(self.directory)

        workers = {worker["role"]: worker for worker in summary["pytorch"]}
        self.assertEqual(
            (workers["conditioner"]["oom"], workers["conditioner"]["failed"], workers["conditioner"]["exited"]),
            (True, True, True),
        )
        self.assertEqual(workers["conditioner"]["max_allocated_bytes"], 44000 * MIB)
        self.assertEqual(
            (workers["interview"]["oom"], workers["interview"]["failed"], workers["interview"]["exited"]),
            (False, True, False),
        )
        self.assertIsNone(summary["first_sample_utc"])
        self.assertIsNone(summary["span_seconds"])

    def test_counts_other_event_types_without_reading_them(self):
        self.write_segment(
            events=[
                make_peak(1, 7, "startup", "start", 0),
                {"event_type": "startup_status", "startup_stage": 5, "monotonic_ns": 2},
                {"event_type": "startup_status", "startup_stage": 6, "monotonic_ns": 3},
                "not an event",
            ],
        )

        summary = self.gpu_summary.summarize_trial(self.directory)

        self.assertEqual(summary["pytorch_event_count"], 1)
        self.assertEqual(summary["other_event_counts"], {"startup_status": 2, "unknown": 1})
        self.assertEqual(len(summary["pytorch"]), 1)

    def test_counts_malformed_segments_as_skipped(self):
        self.write_segment(samples=[make_sample(1, 100, interval=None)])
        (self.directory / "segment-partial.json").write_text('{"trial_id":')
        (self.directory / "segment-shape.json").write_text(json.dumps({"trial_id": TRIAL_ID, "samples": 1, "events": []}))
        (self.directory / "segment-fields.json").write_text(json.dumps({"samples": []}))
        (self.directory / "segment-trial.json").write_text(json.dumps({"trial_id": [], "samples": [], "events": []}))

        summary = self.gpu_summary.summarize_trial(self.directory)

        self.assertEqual((summary["segment_count"], summary["skipped_segment_count"]), (5, 4))
        self.assertEqual(summary["sample_count"], 1)

    def test_rejects_empty_unreadable_and_mixed_trials(self):
        with self.assertRaisesRegex(ValueError, "not zero use"):
            self.gpu_summary.summarize_trial(self.directory)
        (self.directory / "segment-partial.json").write_text("{")
        with self.assertRaisesRegex(ValueError, "not zero use"):
            self.gpu_summary.summarize_trial(self.directory)
        self.write_segment(samples=[make_sample(1, 0)])
        self.write_segment(samples=[make_sample(2, 0)], trial_id="29ab818e-2f38-4e71-9b51-84698a30f10d")
        with self.assertRaisesRegex(ValueError, "more than one trial"):
            self.gpu_summary.summarize_trial(self.directory)

    def test_main_prints_json_or_fails_without_output(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            self.assertEqual(self.gpu_summary.main([str(self.directory)]), 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("not zero use", stderr.getvalue())

        self.write_segment(samples=[make_sample(1, 560, interval=None)])
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            self.assertEqual(self.gpu_summary.main([str(self.directory)]), 0)
        self.assertEqual(json.loads(stdout.getvalue())["devices"][0]["peak_used_mib"], 560)


if __name__ == "__main__":
    unittest.main()
