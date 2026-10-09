import argparse
import json
import os
import re
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


EVENT_DIRECTORY = Path("/run/starfolio-gpu/events")
PHASES = frozenset(
    {"startup", "model_load", "warmup", "serving", "session_init", "session_active"}
)
STATUSES = frozenset({"start", "sample", "phase_end", "failure", "exit"})
METRIC_KEYS = (
    "allocated_bytes",
    "reserved_bytes",
    "phase_max_allocated_bytes",
    "phase_max_reserved_bytes",
    "max_allocated_bytes",
    "max_reserved_bytes",
)
STARTUP_STAGES = {
    "gateway_spawned": 1,
    "conditioner_spawned": 2,
    "encoder_ready": 3,
    "interview_spawned": 4,
    "child_exit": 5,
    "shutdown": 6,
    "tokenizer_smoke_failed": 7,
}
CHILD_ROLES = frozenset({"gateway", "conditioner", "interview"})
FAILURE_CATEGORIES = {"child_nonzero": 1, "child_signal": 2}
SHUTDOWN_REASONS = {"normal": 0, "sigterm": 1, "sigint": 2}


def write_event(event, event_directory, prefix):
    event_directory.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=event_directory, suffix=".tmp", delete=False
    ) as handle:
        temporary_path = Path(handle.name)
        try:
            json.dump(event, handle, separators=(",", ":"), allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
            os.chmod(temporary_path, 0o640)
        except BaseException:
            temporary_path.unlink(missing_ok=True)
            raise
    final_path = event_directory / f"{prefix}-{event['pid']}-{uuid.uuid4().hex}.json"
    try:
        os.replace(temporary_path, final_path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise
    return final_path


def publish_startup_status(
    stage, child_role=None, child_pid=None, exit_code=None, failure_category=None,
    *, shutdown_reason=None, trial_id=None, event_directory=None,
):
    if not isinstance(stage, str) or stage not in STARTUP_STAGES:
        raise ValueError("Unknown startup stage")
    if stage == "child_exit":
        if (
            not isinstance(child_role, str)
            or child_role not in CHILD_ROLES
            or type(child_pid) is not int
            or child_pid <= 0
        ):
            raise ValueError("Invalid child identity")
        if type(exit_code) is not int or not 0 <= exit_code <= 255:
            raise ValueError("Invalid child exit code")
        if exit_code == 0:
            expected_category = None
        elif exit_code >= 128:
            expected_category = "child_signal"
        else:
            expected_category = "child_nonzero"
        if failure_category != expected_category:
            raise ValueError("Invalid child failure category")
    elif any(value is not None for value in (child_role, child_pid, exit_code, failure_category)):
        raise ValueError("Unexpected child exit fields")
    if stage == "shutdown":
        if shutdown_reason not in (None, *SHUTDOWN_REASONS):
            raise ValueError("Invalid shutdown reason")
    elif shutdown_reason is not None:
        raise ValueError("Unexpected shutdown reason")
    resolved_trial_id = trial_id if trial_id is not None else os.environ.get("STARFOLIO_TRIAL_ID", "")
    if not isinstance(resolved_trial_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", resolved_trial_id):
        raise ValueError("Invalid trial ID")
    destination = Path(
        event_directory if event_directory is not None
        else os.environ.get("STARFOLIO_GPU_EVENT_DIR", str(EVENT_DIRECTORY))
    )
    return write_event(
        {
            "schema_version": 2,
            "event_type": "startup_status",
            "trial_id": resolved_trial_id,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "monotonic_ns": time.monotonic_ns(),
            "pid": os.getpid(),
            "process_start_ticks": process_start_ticks(),
            "role": "status_publisher",
            "startup_stage": STARTUP_STAGES[stage],
            "child_role": child_role,
            "child_pid": child_pid,
            "exit_code": exit_code,
            "failure_category": 0 if failure_category is None else FAILURE_CATEGORIES[failure_category],
            "shutdown_reason": SHUTDOWN_REASONS[shutdown_reason or "normal"] if stage == "shutdown" else None,
        },
        destination,
        "startup",
    )


def process_start_ticks(stat_path=None):
    path = Path(stat_path) if stat_path is not None else Path(f"/proc/{os.getpid()}/stat")
    try:
        fields = path.read_text().rsplit(") ", 1)[1].split()
        return int(fields[19])
    except (OSError, IndexError, ValueError):
        return None


class PeakTracker:
    def __init__(
        self,
        role,
        trial_id=None,
        event_directory=None,
        *,
        cuda=None,
        interval=1.0,
    ):
        if role not in {"interview", "conditioner"}:
            raise ValueError("Unknown GPU telemetry role")
        self.role = role
        self.trial_id = trial_id if trial_id is not None else os.environ.get("STARFOLIO_TRIAL_ID", "")
        self.event_directory = Path(
            event_directory
            if event_directory is not None
            else os.environ.get("STARFOLIO_GPU_EVENT_DIR", str(EVENT_DIRECTORY))
        )
        if cuda is None:
            try:
                import torch

                cuda = torch.cuda
            except ImportError:
                cuda = None
        self.cuda = cuda
        self.interval = interval
        self.phase = "startup"
        self.pid = os.getpid()
        self.start_ticks = process_start_ticks()
        self.max_allocated = 0
        self.max_reserved = 0
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None
        self.publish_failure_reported = False

    def __enter__(self):
        self._safely_publish("start")
        self.thread = threading.Thread(target=self._monitor, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, exception_type, exception, traceback):
        self.stop.set()
        if self.thread is not None:
            self.thread.join(timeout=self.interval + 1)
        if exception is not None:
            self._safely_publish("failure", self._is_oom(exception))
        self._safely_publish("exit")
        return False

    def _is_oom(self, exception):
        oom_type = getattr(self.cuda, "OutOfMemoryError", None)
        return isinstance(exception, oom_type) if isinstance(oom_type, type) else False

    def _monitor(self):
        while not self.stop.wait(self.interval):
            self._safely_publish("sample")

    def _safely_publish(self, status, oom=False):
        try:
            self.publish(status, oom)
        except Exception:
            with self.lock:
                if not self.publish_failure_reported:
                    self.publish_failure_reported = True
                    try:
                        print("GPU peak telemetry publish failed", file=sys.stderr)
                    except Exception:
                        pass

    def record_failure(self, exception):
        self._safely_publish("failure", self._is_oom(exception))

    def set_phase(self, phase):
        if phase not in PHASES:
            raise ValueError("Unknown GPU telemetry phase")
        with self.lock:
            if phase == self.phase:
                return
            self._safely_publish("phase_end")
            self.phase = phase
            if self.cuda is not None:
                try:
                    if self.cuda.is_available():
                        self.cuda.reset_peak_memory_stats()
                except Exception:
                    pass

    def publish(self, status, oom=False):
        if status not in STATUSES:
            raise ValueError("Unknown GPU telemetry status")
        with self.lock:
            metrics = self._metrics()
            event = {
                "event_type": "pytorch_peak",
                "schema_version": 1,
                "trial_id": self.trial_id,
                "timestamp_utc": datetime.now(timezone.utc).isoformat(),
                "monotonic_ns": time.monotonic_ns(),
                "pid": self.pid,
                "process_start_ticks": self.start_ticks,
                "role": self.role,
                "phase": self.phase,
                "status": status,
                "oom": bool(oom),
                **metrics,
            }
            return write_event(event, self.event_directory, "peak")

    def _metrics(self):
        if self.cuda is None:
            return dict.fromkeys(METRIC_KEYS)
        try:
            if not self.cuda.is_available():
                return dict.fromkeys(METRIC_KEYS)
            allocated = int(self.cuda.memory_allocated())
            reserved = int(self.cuda.memory_reserved())
            phase_allocated = int(self.cuda.max_memory_allocated())
            phase_reserved = int(self.cuda.max_memory_reserved())
            self.max_allocated = max(self.max_allocated, phase_allocated)
            self.max_reserved = max(self.max_reserved, phase_reserved)
        except Exception:
            return dict.fromkeys(METRIC_KEYS)
        return {
            "allocated_bytes": allocated,
            "reserved_bytes": reserved,
            "phase_max_allocated_bytes": phase_allocated,
            "phase_max_reserved_bytes": phase_reserved,
            "max_allocated_bytes": self.max_allocated,
            "max_reserved_bytes": self.max_reserved,
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("startup", choices=["startup"])
    parser.add_argument("--stage", required=True, choices=sorted(STARTUP_STAGES))
    parser.add_argument("--child-role", choices=sorted(CHILD_ROLES))
    parser.add_argument("--child-pid", type=int)
    parser.add_argument("--exit-code", type=int)
    parser.add_argument("--failure-category", choices=sorted(FAILURE_CATEGORIES))
    parser.add_argument("--shutdown-reason", choices=sorted(SHUTDOWN_REASONS))
    args = parser.parse_args()
    publish_startup_status(
        args.stage, args.child_role, args.child_pid, args.exit_code, args.failure_category,
        shutdown_reason=args.shutdown_reason,
    )


if __name__ == "__main__":
    main()
