import argparse
import json
import statistics
import sys
from collections import Counter
from pathlib import Path

GAP_MS = 1000
PEAK_EVENT = "pytorch_peak"


def peak(values):
    present = [value for value in values if value is not None]
    return max(present) if present else None


def read_segments(directory):
    samples, events, skipped, trial_ids = [], [], 0, set()
    paths = sorted(Path(directory).glob("segment-*.json"))
    for path in paths:
        try:
            body = json.loads(path.read_text())
            trial_id, segment_samples, segment_events = body["trial_id"], body["samples"], body["events"]
        except (OSError, ValueError, KeyError, TypeError):
            skipped += 1
            continue
        if (
            not isinstance(trial_id, str)
            or not isinstance(segment_samples, list)
            or not isinstance(segment_events, list)
        ):
            skipped += 1
            continue
        trial_ids.add(trial_id)
        samples.extend(segment_samples)
        events.extend(segment_events)
    if len(paths) == skipped:
        raise ValueError("No readable GPU segments; absent evidence is not zero use")
    if len(trial_ids) != 1:
        raise ValueError("Segments belong to more than one trial")
    return trial_ids.pop(), samples, events, len(paths), skipped


def summarize_intervals(samples):
    intervals = sorted(
        sample["actual_interval_ms"]
        for sample in samples
        if sample.get("actual_interval_ms") is not None
    )
    if not intervals:
        return {"median": None, "p95": None, "max": None}, None
    p95 = (
        statistics.quantiles(intervals, n=20, method="inclusive")[18]
        if len(intervals) > 1
        else intervals[0]
    )
    summary = {"median": statistics.median(intervals), "p95": p95, "max": intervals[-1]}
    return summary, sum(1 for interval in intervals if interval > GAP_MS)


def summarize_devices(samples):
    devices = {}
    for sample in samples:
        devices.setdefault(sample.get("gpu_uuid"), []).append(sample)
    summaries = []
    for gpu_uuid, rows in devices.items():
        used = [row for row in rows if row.get("device_used_mib") is not None]
        top = max(used, key=lambda row: row["device_used_mib"]) if used else None
        summaries.append(
            {
                "gpu_uuid": gpu_uuid,
                "total_mib": peak(row.get("device_total_mib") for row in rows),
                "peak_used_mib": top["device_used_mib"] if top else None,
                "peak_used_utc": top["utc"] if top else None,
                "peak_utilization_percent": peak(
                    row.get("device_utilization_percent") for row in rows
                ),
            }
        )
    return summaries


def summarize_processes(samples):
    processes = {}
    for sample in samples:
        for process in sample.get("processes", []):
            key = (process.get("role"), process.get("pid"), process.get("process_start_ticks"))
            processes.setdefault(key, []).append(process.get("used_mib"))
    return [
        {
            "role": role,
            "pid": pid,
            "process_start_ticks": start_ticks,
            "sample_count": len(used),
            "peak_used_mib": peak(used),
        }
        for (role, pid, start_ticks), used in processes.items()
    ]


def summarize_peaks(events):
    workers = {}
    for event in sorted(events, key=lambda event: event.get("monotonic_ns") or 0):
        key = (event.get("role"), event.get("pid"), event.get("process_start_ticks"))
        workers.setdefault(key, []).append(event)
    summaries = []
    for (role, pid, start_ticks), rows in workers.items():
        phases = []
        for row in rows:
            if not phases or phases[-1]["phase"] != row.get("phase"):
                phases.append({"phase": row.get("phase"), "first_utc": row.get("timestamp_utc"), "rows": []})
            phases[-1]["rows"].append(row)
        summaries.append(
            {
                "role": role,
                "pid": pid,
                "process_start_ticks": start_ticks,
                "oom": any(row.get("oom") is True for row in rows),
                "failed": any(row.get("status") == "failure" for row in rows),
                "exited": any(row.get("status") == "exit" for row in rows),
                "max_allocated_bytes": peak(row.get("max_allocated_bytes") for row in rows),
                "max_reserved_bytes": peak(row.get("max_reserved_bytes") for row in rows),
                "phases": [
                    {
                        "phase": phase["phase"],
                        "first_utc": phase["first_utc"],
                        "last_utc": phase["rows"][-1].get("timestamp_utc"),
                        "peak_allocated_bytes": peak(
                            row.get("phase_max_allocated_bytes") for row in phase["rows"]
                        ),
                        "peak_reserved_bytes": peak(
                            row.get("phase_max_reserved_bytes") for row in phase["rows"]
                        ),
                    }
                    for phase in phases
                ],
            }
        )
    return summaries


def summarize_trial(directory):
    trial_id, samples, events, segment_count, skipped = read_segments(directory)
    samples = sorted(
        (sample for sample in samples if isinstance(sample, dict)),
        key=lambda sample: sample.get("monotonic_ns") or 0,
    )
    kinds = Counter(
        event.get("event_type") if isinstance(event, dict) and isinstance(event.get("event_type"), str) else "unknown"
        for event in events
    )
    peak_count = kinds.pop(PEAK_EVENT, 0)
    interval_ms, gap_count = summarize_intervals(samples)
    clocks = [sample["monotonic_ns"] for sample in samples if sample.get("monotonic_ns") is not None]
    return {
        "trial_id": trial_id,
        "segment_count": segment_count,
        "skipped_segment_count": skipped,
        "sample_count": len(samples),
        "first_sample_utc": samples[0].get("utc") if samples else None,
        "last_sample_utc": samples[-1].get("utc") if samples else None,
        "span_seconds": round((clocks[-1] - clocks[0]) / 1e9, 3) if clocks else None,
        "interval_ms": interval_ms,
        "gap_count": gap_count,
        "devices": summarize_devices(samples),
        "processes": summarize_processes(samples),
        "pytorch_event_count": peak_count,
        "pytorch": summarize_peaks(
            [event for event in events if isinstance(event, dict) and event.get("event_type") == PEAK_EVENT]
        ),
        "other_event_counts": dict(sorted(kinds.items())),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Summarize downloaded GPU trial segments; reads local files only"
    )
    parser.add_argument("directory", type=Path)
    args = parser.parse_args(argv)
    try:
        summary = summarize_trial(args.directory)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    json.dump(summary, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
