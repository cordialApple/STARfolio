import json
import os
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


EVENT_DIRECTORY = Path("/var/lib/starfolio-gpu/events")
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
        event_directory=EVENT_DIRECTORY,
        *,
        cuda=None,
        interval=1.0,
    ):
        if role not in {"interview", "conditioner"}:
            raise ValueError("Unknown GPU telemetry role")
        self.role = role
        self.trial_id = trial_id if trial_id is not None else os.environ.get("STARFOLIO_TRIAL_ID", "")
        self.event_directory = Path(event_directory)
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
            self.event_directory.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=self.event_directory, suffix=".tmp", delete=False
            ) as handle:
                temporary_path = Path(handle.name)
                try:
                    json.dump(event, handle, separators=(",", ":"), allow_nan=False)
                    handle.flush()
                    os.fsync(handle.fileno())
                except BaseException:
                    temporary_path.unlink(missing_ok=True)
                    raise
            final_path = self.event_directory / f"peak-{self.pid}-{uuid.uuid4().hex}.json"
            try:
                os.replace(temporary_path, final_path)
            except BaseException:
                temporary_path.unlink(missing_ok=True)
                raise
            return final_path

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
