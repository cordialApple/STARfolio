import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from uuid import UUID, uuid4

METRICS = {
    "CPUUtilization": ("Average", "Percent"),
    "NetworkIn": ("Sum", "Bytes"),
    "NetworkOut": ("Sum", "Bytes"),
    "StatusCheckFailed": ("Maximum", "Count"),
}


def utc(value):
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def validate_trial_id(trial_id):
    try:
        parsed = UUID(trial_id)
    except ValueError as error:
        raise ValueError("Trial ID must be a UUIDv4") from error
    if parsed.version != 4 or str(parsed) != trial_id:
        raise ValueError("Trial ID must be a UUIDv4")


def default_output_root():
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library/Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    return base / "STARfolio/trials"


def aws_client(region, profile=None):
    def call(service, operation, *args):
        command = ["aws", "--region", region, "--no-cli-pager", "--output", "json"]
        if profile:
            command.extend(["--profile", profile])
        command.extend([service, operation, *args])
        print(shlex.join(command), file=sys.stderr)
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        return json.loads(result.stdout) if result.stdout.strip() else {}

    return call


def capture_snapshot(aws, config, trial_id, now=None):
    validate_trial_id(trial_id)
    now = now or datetime.now(timezone.utc)
    observed_at = utc(now)
    errors = {}
    result = {
        "schemaVersion": 1,
        "recordType": "aws-observation",
        "trialId": trial_id,
        "observedAtUtc": observed_at,
        "accountId": None,
        "region": config["region"],
        "bundleSha256": config.get("bundle_sha256"),
        "stackName": config["name"],
        "stackStatus": None,
        "instance": None,
        "metrics": None,
        "errors": errors,
    }
    try:
        result["accountId"] = aws("sts", "get-caller-identity").get("Account")
    except (OSError, subprocess.CalledProcessError, KeyError) as error:
        errors["identity"] = str(error)
    try:
        stack = aws("cloudformation", "describe-stacks", "--stack-name", config["name"])["Stacks"][0]
        outputs = {item["OutputKey"]: item["OutputValue"] for item in stack.get("Outputs", [])}
        if outputs.get("TrialId") != trial_id:
            errors["stack"] = "Stack trial ID absent or different"
        else:
            result["stackStatus"] = stack.get("StackStatus")
    except (OSError, subprocess.CalledProcessError, KeyError, IndexError) as error:
        errors["stack"] = str(error)
    try:
        reservations = aws(
            "ec2", "describe-instances", "--filters",
            json.dumps([{"Name": "tag:StarfolioTrial", "Values": [trial_id]}]),
        ).get("Reservations", [])
        instances = [item for group in reservations for item in group.get("Instances", [])]
        if len(instances) > 1:
            errors["instance"] = "Multiple instances carry the trial ID"
            return result
        if not instances:
            return result
        item = instances[0]
        instance_id = item["InstanceId"]
        launch = item.get("LaunchTime")
        if isinstance(launch, datetime):
            launch = utc(launch)
        result["instance"] = {
            "id": instance_id,
            "state": item.get("State", {}).get("Name"),
            "type": item.get("InstanceType"),
            "ami": item.get("ImageId"),
            "monitoringState": item.get("Monitoring", {}).get("State"),
            "launchTimeUtc": launch,
            "stateTransitionReason": item.get("StateTransitionReason"),
            "ebsVolumeId": None,
            "ebsGiB": None,
            "ebsType": None,
        }
    except (OSError, subprocess.CalledProcessError, KeyError) as error:
        errors["instance"] = str(error)
        return result
    volumes = [mapping.get("Ebs", {}).get("VolumeId") for mapping in item.get("BlockDeviceMappings", [])]
    volumes = [volume for volume in volumes if volume]
    if len(volumes) == 1:
        result["instance"]["ebsVolumeId"] = volumes[0]
        try:
            volume = aws("ec2", "describe-volumes", "--volume-ids", volumes[0])["Volumes"][0]
            result["instance"]["ebsGiB"] = volume.get("Size")
            result["instance"]["ebsType"] = volume.get("VolumeType")
        except (OSError, subprocess.CalledProcessError, KeyError, IndexError) as error:
            errors["volume"] = str(error)
    elif volumes:
        errors["volume"] = "Expected one root volume"
    if not launch:
        errors["metrics"] = "Instance launch time unavailable"
        return result
    result["metrics"] = {}
    for name, (statistic, unit) in METRICS.items():
        period = 60 if name == "StatusCheckFailed" or result["instance"]["monitoringState"] == "enabled" else 300
        metric = {
            "periodSeconds": period,
            "statistic": statistic,
            "unit": unit,
            "windowStartUtc": launch,
            "windowEndUtc": observed_at,
            "datapoints": None,
        }
        result["metrics"][name] = metric
        try:
            response = aws(
                "cloudwatch", "get-metric-statistics",
                "--namespace", "AWS/EC2",
                "--metric-name", name,
                "--dimensions", f"Name=InstanceId,Value={instance_id}",
                "--start-time", launch,
                "--end-time", observed_at,
                "--period", str(period),
                "--statistics", statistic,
            )
            metric["datapoints"] = sorted(response.get("Datapoints", []), key=lambda point: str(point.get("Timestamp", "")))
        except (OSError, subprocess.CalledProcessError, KeyError) as error:
            errors[name] = str(error)
    return result


def append_observation(root, record):
    trial_id = record["trialId"]
    validate_trial_id(trial_id)
    directory = root / trial_id / "observations"
    directory.mkdir(parents=True, exist_ok=True)
    event_id = str(uuid4())
    path = directory / f"{event_id}.json"
    temporary = directory / f"{event_id}.tmp"
    data = {**record, "observationId": event_id}
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(data, output, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        if path.exists():
            raise FileExistsError(path)
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return path


def make_billing_annotation(
    trial_id, amount, currency, scope, attribution, *, window_start, window_end, source, now=None
):
    validate_trial_id(trial_id)
    try:
        value = Decimal(amount)
    except InvalidOperation as error:
        raise ValueError("Invalid posted amount") from error
    if not value.is_finite() or value < 0 or not re.fullmatch(r"[A-Z]{3}", currency):
        raise ValueError("Invalid posted amount or currency")
    if scope not in ("trial-tag", "account-window") or attribution not in ("trial-cost", "unattributed"):
        raise ValueError("Invalid billing scope or attribution")
    if attribution == "trial-cost" and scope != "trial-tag":
        raise ValueError("Account-window cost cannot be attributed to one trial")
    if (
        window_start.tzinfo is None
        or window_end.tzinfo is None
        or window_start >= window_end
        or not source.strip()
        or len(source) > 500
    ):
        raise ValueError("Billing annotation needs a UTC window and source")
    return {
        "schemaVersion": 1,
        "recordType": "billing-annotation",
        "trialId": trial_id,
        "observedAtUtc": utc(now or datetime.now(timezone.utc)),
        "amount": str(value),
        "currency": currency,
        "scope": scope,
        "attribution": attribution,
        "windowStartUtc": utc(window_start),
        "windowEndUtc": utc(window_end),
        "source": source,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Append local AWS trial observations; never launch resources")
    parser.add_argument("--trial-id", required=True)
    parser.add_argument("--output-dir", type=Path, default=default_output_root())
    subparsers = parser.add_subparsers(dest="command", required=True)
    capture = subparsers.add_parser("capture")
    capture.add_argument("--config", type=Path, required=True)
    capture.add_argument("--profile")
    billing = subparsers.add_parser("billing")
    billing.add_argument("--amount", required=True)
    billing.add_argument("--currency", default="USD")
    billing.add_argument("--scope", choices=("trial-tag", "account-window"), required=True)
    billing.add_argument("--attribution", choices=("trial-cost", "unattributed"), required=True)
    billing.add_argument("--source", required=True)
    billing.add_argument("--window-start", required=True)
    billing.add_argument("--window-end", required=True)
    args = parser.parse_args(argv)
    if args.command == "capture":
        config = json.loads(args.config.read_text(encoding="utf-8-sig"))
        if not re.fullmatch(r"us-(?:east-[12]|west-[12])", config["region"]):
            raise ValueError("Invalid region")
        if not re.fullmatch(r"starfolio-demo(?:-[a-z0-9-]{1,32})?", config["name"]):
            raise ValueError("Invalid stack name")
        record = capture_snapshot(aws_client(config["region"], args.profile), config, args.trial_id)
    else:
        record = make_billing_annotation(
            args.trial_id,
            args.amount,
            args.currency,
            args.scope,
            args.attribution,
            window_start=datetime.fromisoformat(args.window_start.replace("Z", "+00:00")),
            window_end=datetime.fromisoformat(args.window_end.replace("Z", "+00:00")),
            source=args.source,
        )
    print(append_observation(args.output_dir, record))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        print(f"Trial command failed: {error}", file=sys.stderr)
        sys.exit(1)
