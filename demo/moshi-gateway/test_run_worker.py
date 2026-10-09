import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


RUN_WORKER = Path(__file__).with_name("run-worker.sh")
STOP_WORKER = Path(__file__).with_name("stop-worker.sh")
INVOCATION_ID = "a" * 32


class RunWorkerTests(unittest.TestCase):
    def run_fake_supervisor(
        self, gateway_exit_code, terminate=False, marker_write_failure=False,
        terminate_during_cleanup=False,
    ):
        bash = shutil.which("bash")
        if os.name == "nt":
            bash = r"C:\Program Files\Git\bin\bash.exe"
        if not bash or not Path(bash).exists():
            self.skipTest("Bash unavailable")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker_path = "./missing/worker-complete" if marker_write_failure else "./worker-complete"
            script = RUN_WORKER.read_text().replace(
                "py=/opt/starfolio-runtime/venv/bin/python", "py=./fake-python.sh"
            ).replace("/run/starfolio-private/worker-complete", marker_path)
            (root / "run-worker.sh").write_text(script)
            fake_python = root / "fake-python.sh"
            fake_python.write_text(
                '#!/usr/bin/env bash\n'
                'case "$1" in\n'
                '  gpu_peaks.py)\n'
                '    printf "%s\\n" "$*" >> events.txt\n'
                '    if [[ "${PAUSE_SHUTDOWN:-}" == 1 && "$*" == *"--stage shutdown"* ]]; then sleep 2; fi ;;\n'
                '  gateway.py)\n'
                '    printf "%s" "$$" > gateway.pid\n'
                '    if [[ "$GATEWAY_EXIT_CODE" == hold ]]; then exec sleep 30; fi\n'
                '    sleep 1\n'
                '    exit "$GATEWAY_EXIT_CODE" ;;\n'
                '  conditioner_worker.py|interview_worker.py) exec sleep "${FAKE_CHILD_SLEEP:-30}" ;;\n'
                '  -c) exit 0 ;;\n'
                '  *) exit 99 ;;\n'
                'esac\n'
            )
            fake_python.chmod(0o755)
            environment = os.environ.copy()
            environment["GATEWAY_EXIT_CODE"] = str(gateway_exit_code)
            environment["INVOCATION_ID"] = INVOCATION_ID
            if terminate_during_cleanup:
                environment["PAUSE_SHUTDOWN"] = "1"
                environment["FAKE_CHILD_SLEEP"] = "5"
                control = root / "control.sh"
                control.write_text(
                    'bash run-worker.sh &\n'
                    'supervisor=$!\n'
                    'for attempt in {1..100}; do\n'
                    '  if [[ -f worker-complete && -f events.txt ]] && grep -q "startup --stage shutdown" events.txt; then break; fi\n'
                    '  sleep 0.05\n'
                    'done\n'
                    'kill -TERM "$supervisor"\n'
                    'wait "$supervisor"\n'
                )
                command = [bash, "control.sh"]
            elif terminate:
                control = root / "control.sh"
                control.write_text(
                    'bash run-worker.sh &\n'
                    'supervisor=$!\n'
                    'for attempt in {1..100}; do\n'
                    '  if [[ -f events.txt ]] && grep -q "startup --stage interview_spawned" events.txt; then break; fi\n'
                    '  sleep 0.05\n'
                    'done\n'
                    'kill -TERM "$supervisor"\n'
                    'wait "$supervisor"\n'
                )
                command = [bash, "control.sh"]
            else:
                command = [bash, "run-worker.sh"]
            result = subprocess.run(
                command, cwd=root, env=environment, capture_output=True, text=True, timeout=15
            )
            events = (root / "events.txt").read_text().splitlines()
            gateway_pid = (root / "gateway.pid").read_text()
            marker = root / "worker-complete"
            return result, events, gateway_pid, marker.read_text() if marker.exists() else None

    def test_failing_gateway_records_child_identity_and_normal_shutdown(self):
        result, events, gateway_pid, marker = self.run_fake_supervisor(17)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertTrue(any(
            event.startswith("gpu_peaks.py startup --stage child_exit ")
            and "--child-role gateway" in event
            and f"--child-pid {gateway_pid}" in event
            and "--exit-code 17" in event
            and "--failure-category child_nonzero" in event
            for event in events
        ), events)
        self.assertIn("gpu_peaks.py startup --stage shutdown --shutdown-reason normal", events)
        self.assertEqual(marker, INVOCATION_ID)

    def test_sigterm_records_shutdown_reason(self):
        result, events, _, marker = self.run_fake_supervisor("hold", terminate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("gpu_peaks.py startup --stage shutdown --shutdown-reason sigterm", events)
        self.assertFalse(any("--stage child_exit" in event for event in events), events)
        self.assertIsNone(marker)

    def test_marker_write_failure_keeps_observed_child_exit_status(self):
        result, events, _, marker = self.run_fake_supervisor(17, marker_write_failure=True)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertTrue(any("--stage child_exit" in event for event in events), events)
        self.assertIsNone(marker)

    def test_sigterm_during_cleanup_removes_completion_marker(self):
        result, events, _, marker = self.run_fake_supervisor(
            0, terminate_during_cleanup=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any("--stage shutdown" in event for event in events), events)
        self.assertIsNone(marker)

    def test_stop_hook_powers_off_only_for_current_completed_invocation(self):
        self.assertTrue(STOP_WORKER.exists(), "restart-safe stop hook missing")
        bash = shutil.which("bash")
        if os.name == "nt":
            bash = r"C:\Program Files\Git\bin\bash.exe"
        if not bash or not Path(bash).exists():
            self.skipTest("Bash unavailable")
        for current_id, marker_id, expected in (
            (INVOCATION_ID, INVOCATION_ID, True),
            (INVOCATION_ID, "b" * 32, False),
            (INVOCATION_ID, None, False),
            ("bad", INVOCATION_ID, False),
        ):
            with self.subTest(current_id=current_id, marker_id=marker_id):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    script = STOP_WORKER.read_text().replace(
                        "/run/starfolio-private/worker-complete", "./worker-complete"
                    ).replace("/sbin/shutdown -h now", "./fake-shutdown.sh")
                    (root / "stop-worker.sh").write_text(script)
                    (root / "fake-shutdown.sh").write_text(
                        '#!/usr/bin/env bash\nprintf "%s\\n" called >> shutdown.txt\n'
                    )
                    (root / "fake-shutdown.sh").chmod(0o755)
                    if marker_id is not None:
                        (root / "worker-complete").write_text(marker_id)
                    environment = os.environ.copy()
                    environment["INVOCATION_ID"] = current_id
                    result = subprocess.run(
                        [bash, "stop-worker.sh"], cwd=root, env=environment,
                        capture_output=True, text=True, timeout=5,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual((root / "shutdown.txt").exists(), expected)

    def test_supervisor_captures_identified_child_exit_and_shutdown(self):
        script = RUN_WORKER.read_text()
        self.assertIn('wait -n -p exited_pid "${pids[@]}"', script)
        self.assertIn('gpu_peaks.py startup --stage child_exit', script)
        self.assertIn('gpu_peaks.py startup --stage shutdown', script)
        self.assertIn('--child-role "$child_role"', script)
        self.assertIn('--child-pid "$exited_pid"', script)
        self.assertIn('--exit-code "$exit_code"', script)

    def test_supervisor_records_startup_milestones_without_command_output(self):
        script = RUN_WORKER.read_text()
        for stage in (
            "gateway_spawned", "conditioner_spawned", "encoder_ready", "interview_spawned",
        ):
            with self.subTest(stage=stage):
                self.assertIn(f"gpu_peaks.py startup --stage {stage}", script)


if __name__ == "__main__":
    unittest.main()
