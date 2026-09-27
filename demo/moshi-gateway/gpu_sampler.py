import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


EVENT_NUMBERS = (
    "monotonic_ns",
    "pid",
    "process_start_ticks",
    "allocated_bytes",
    "reserved_bytes",
    "max_allocated_bytes",
    "max_reserved_bytes",
    "phase_max_allocated_bytes",
    "phase_max_reserved_bytes",
)
EVENT_FIELDS = set(EVENT_NUMBERS) | {
    "schema_version",
    "event_type",
    "trial_id",
    "timestamp_utc",
    "role",
    "phase",
    "status",
    "oom",
}
ROLE_NAMES = {"interview", "conditioner"}
EVENT_STATUSES = {"start", "sample", "phase_end", "failure", "exit"}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def optional_int(value):
    try:
        number = int(value.strip())
    except (AttributeError, TypeError, ValueError):
        return None
    return number if number >= 0 else None


def gpu_uuid_or_none(value):
    return value if re.fullmatch(r"GPU-[A-Fa-f0-9-]+", value) else None


def process_start_ticks(proc_root, pid):
    try:
        stat = (proc_root / str(pid) / "stat").read_text()
        return optional_int(stat[stat.rfind(")") + 1 :].split()[19])
    except (OSError, IndexError):
        return None


def write_atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=path.stem + "-", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        try:
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        except OSError:
            pass
    finally:
        temporary.unlink(missing_ok=True)


class GpuSampler:
    def __init__(
        self,
        trial_id,
        destination_uri,
        spool_dir=Path("/var/lib/starfolio-gpu"),
        event_dir=None,
        owner_dir=None,
        proc_root=Path("/proc"),
        command=subprocess.run,
        monotonic=time.monotonic,
        utc=utc_now,
        sample_interval=0.25,
        upload_interval=5.0,
    ):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", trial_id):
            raise ValueError("Invalid trial ID")
        if not re.fullmatch(r"s3://[A-Za-z0-9.-]+/[A-Za-z0-9_./-]+/", destination_uri):
            raise ValueError("GPU destination must be an S3 prefix ending in /")
        self.trial_id = trial_id
        self.destination_uri = destination_uri
        self.spool_dir = Path(spool_dir)
        self.event_dir = Path(event_dir) if event_dir else self.spool_dir / "events"
        self.owner_dir = Path(owner_dir) if owner_dir else self.spool_dir / "owners"
        self.proc_root = Path(proc_root)
        self.command = command
        self.monotonic = monotonic
        self.utc = utc
        self.sample_interval = sample_interval
        self.upload_interval = upload_interval
        self.records = []
        self.last_sample_time = None
        self.spool_dir.mkdir(parents=True, exist_ok=True)
        self.event_dir.mkdir(parents=True, exist_ok=True)

    def query(self, field):
        try:
            result = self.command(
                ["nvidia-smi", field, "--format=csv,noheader,nounits"],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return ""
        return result.stdout if result.returncode == 0 else ""

    def read_events(self):
        claimed = set()
        for segment in self.spool_dir.glob("segment-*.json"):
            try:
                claimed.update(json.loads(segment.read_text())["event_files"])
            except (OSError, ValueError, KeyError, TypeError):
                continue
        events = []
        for path in sorted(self.event_dir.glob("*.json")):
            if path.name in claimed:
                continue
            try:
                raw = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            event = self.valid_event(raw)
            if event is not None:
                events.append((path, event))
        return events

    def valid_event(self, raw):
        if not isinstance(raw, dict) or set(raw) != EVENT_FIELDS:
            return None
        if (
            raw["schema_version"] != 1
            or raw["event_type"] != "pytorch_peak"
            or raw["trial_id"] != self.trial_id
            or not isinstance(raw["role"], str)
            or raw["role"] not in ROLE_NAMES
            or not isinstance(raw["status"], str)
            or raw["status"] not in EVENT_STATUSES
            or type(raw["oom"]) is not bool
        ):
            return None
        if not isinstance(raw["phase"], str) or not re.fullmatch(
            r"[a-z][a-z0-9_-]{0,39}", raw["phase"]
        ):
            return None
        if not isinstance(raw["timestamp_utc"], str) or not re.fullmatch(
            r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)",
            raw["timestamp_utc"],
        ):
            return None
        for field in EVENT_NUMBERS:
            value = raw[field]
            if value is not None and (type(value) is not int or value < 0):
                return None
        if raw["pid"] is None or raw["pid"] == 0:
            return None
        return raw

    def role_for(self, pid, start_ticks, events):
        if start_ticks is None:
            return None
        for _, event in events:
            if event["pid"] == pid and event["process_start_ticks"] == start_ticks:
                return event["role"]
        try:
            owner = json.loads((self.owner_dir / f"{pid}.json").read_text())
        except (OSError, ValueError):
            return None
        if not isinstance(owner, dict):
            return None
        if (
            owner.get("pid") == pid
            and owner.get("process_start_ticks") == start_ticks
            and owner.get("role") in ROLE_NAMES
        ):
            return owner["role"]
        return None

    def sample_once(self):
        now = self.monotonic()
        interval = (
            None
            if self.last_sample_time is None
            else max(0, round((now - self.last_sample_time) * 1000))
        )
        self.last_sample_time = now
        gpu_rows = self.query(
            "--query-gpu=uuid,memory.total,memory.used,memory.free,utilization.gpu"
        )
        process_rows = self.query(
            "--query-compute-apps=gpu_uuid,pid,used_gpu_memory"
        )
        events = self.read_events()
        processes = []
        for line in process_rows.splitlines():
            parts = [part.strip() for part in line.split(",")]
            if len(parts) != 3:
                continue
            pid = optional_int(parts[1])
            if pid is None or pid == 0:
                continue
            start_ticks = process_start_ticks(self.proc_root, pid)
            processes.append(
                {
                    "gpu_uuid": gpu_uuid_or_none(parts[0]),
                    "pid": pid,
                    "process_start_ticks": start_ticks,
                    "used_mib": optional_int(parts[2]),
                    "role": self.role_for(pid, start_ticks, events),
                }
            )
        rows = []
        for line in gpu_rows.splitlines():
            parts = [part.strip() for part in line.split(",")]
            if len(parts) != 5:
                continue
            gpu_uuid = gpu_uuid_or_none(parts[0])
            rows.append((gpu_uuid, *[optional_int(value) for value in parts[1:]]))
        if not rows:
            rows = [(None, None, None, None, None)]
        for gpu_uuid, total, used, free, utilization in rows:
            self.records.append(
                {
                    "schema_version": 1,
                    "trial_id": self.trial_id,
                    "utc": self.utc(),
                    "monotonic_ns": round(now * 1_000_000_000),
                    "actual_interval_ms": interval,
                    "gpu_uuid": gpu_uuid,
                    "device_total_mib": total,
                    "device_used_mib": used,
                    "device_free_mib": free,
                    "device_utilization_percent": utilization,
                    "processes": [
                        process for process in processes if process["gpu_uuid"] == gpu_uuid
                    ],
                }
            )
        return self.records[-len(rows) :]

    def flush(self):
        events = self.read_events()
        if not self.records and not events:
            return None
        segment_id = uuid.uuid4().hex
        path = self.spool_dir / f"segment-{segment_id}.json"
        body = {
            "schema_version": 1,
            "trial_id": self.trial_id,
            "segment_id": segment_id,
            "created_utc": self.utc(),
            "samples": self.records,
            "events": [event for _, event in events],
            "event_files": [path.name for path, _ in events],
        }
        content = json.dumps(body, separators=(",", ":"), sort_keys=True).encode()
        write_atomic(path, content)
        for _, event in events:
            self.record_owner(event)
        self.records = []
        return path

    def upload_pending(self):
        for segment in sorted(self.spool_dir.glob("segment-*.json")):
            receipt = segment.with_suffix(".uploaded")
            try:
                content = segment.read_bytes()
                body = json.loads(content)
            except (OSError, ValueError):
                continue
            if not isinstance(body, dict) or not isinstance(
                body.get("samples"), list
            ) or not isinstance(body.get("events"), list):
                continue
            if receipt.exists():
                self.acknowledge_segment(segment, body)
                continue
            destination = self.destination_uri + segment.name
            try:
                result = self.command(
                    [
                        "aws",
                        "s3",
                        "cp",
                        str(segment),
                        destination,
                        "--sse",
                        "AES256",
                        "--only-show-errors",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=20,
                    check=False,
                )
            except (OSError, subprocess.TimeoutExpired):
                continue
            if result.returncode != 0:
                continue
            write_atomic(
                receipt,
                json.dumps(
                    {
                        "s3_uri": destination,
                        "sha256": hashlib.sha256(content).hexdigest(),
                        "sample_count": len(body["samples"]),
                        "event_count": len(body["events"]),
                        "uploaded_utc": self.utc(),
                    },
                    separators=(",", ":"),
                ).encode(),
            )
            self.acknowledge_segment(segment, body)

    def acknowledge_segment(self, segment, body):
        for name, raw in zip(body.get("event_files", []), body.get("events", [])):
            event = self.valid_event(raw)
            if event is None:
                continue
            self.record_owner(event)
            if re.fullmatch(r"[A-Za-z0-9_-]+\.json", name):
                (self.event_dir / name).unlink(missing_ok=True)
        segment.unlink(missing_ok=True)

    def record_owner(self, event):
        if event["process_start_ticks"] is None:
            return
        owner = {
            "pid": event["pid"],
            "process_start_ticks": event["process_start_ticks"],
            "role": event["role"],
        }
        try:
            write_atomic(
                self.owner_dir / f'{event["pid"]}.json',
                json.dumps(owner, separators=(",", ":")).encode(),
            )
        except OSError:
            pass

    def run(self, stop_event):
        next_sample = self.monotonic()
        next_upload = self.monotonic() + self.upload_interval
        uploader = None
        try:
            while not stop_event.is_set():
                self.sample_once()
                now = self.monotonic()
                if now >= next_upload:
                    self.flush()
                    if uploader is None or not uploader.is_alive():
                        uploader = threading.Thread(
                            target=self.upload_pending, daemon=True
                        )
                        uploader.start()
                    next_upload = now + self.upload_interval
                next_sample = max(
                    next_sample + self.sample_interval, self.monotonic()
                )
                stop_event.wait(max(0, next_sample - self.monotonic()))
        finally:
            if uploader is not None:
                uploader.join()
            for _ in range(2):
                self.flush()
                self.upload_pending()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--spool-dir", type=Path, default=Path("/var/lib/starfolio-gpu"))
    args = parser.parse_args()
    stop_event = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop_event.set())
    signal.signal(signal.SIGINT, lambda *_: stop_event.set())
    sampler = GpuSampler(
        trial_id=os.environ["STARFOLIO_TRIAL_ID"],
        destination_uri=os.environ["STARFOLIO_TRIAL_GPU_URI"],
        spool_dir=args.spool_dir,
        event_dir=Path(
            os.environ.get("STARFOLIO_GPU_EVENT_DIR", str(args.spool_dir / "events"))
        ),
    )
    sampler.run(stop_event)


if __name__ == "__main__":
    main()
