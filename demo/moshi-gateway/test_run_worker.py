import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


RUN_WORKER = Path(__file__).with_name("run-worker.sh")


class RunWorkerTests(unittest.TestCase):
    def run_fake_supervisor(self, gateway_exit_code, terminate=False):
        bash = shutil.which("bash")
        if os.name == "nt":
            bash = r"C:\Program Files\Git\bin\bash.exe"
        if not bash or not Path(bash).exists():
            self.skipTest("Bash unavailable")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = RUN_WORKER.read_text().replace(
                "py=/opt/starfolio-runtime/venv/bin/python", "py=./fake-python.sh"
            )
            (root / "run-worker.sh").write_text(script)
            fake_python = root / "fake-python.sh"
            fake_python.write_text(
                '#!/usr/bin/env bash\n'
                'case "$1" in\n'
                '  gpu_peaks.py) printf "%s\\n" "$*" >> events.txt ;;\n'
                '  gateway.py)\n'
                '    printf "%s" "$$" > gateway.pid\n'
                '    if [[ "$GATEWAY_EXIT_CODE" == hold ]]; then exec sleep 30; fi\n'
                '    sleep 1\n'
                '    exit "$GATEWAY_EXIT_CODE" ;;\n'
                '  conditioner_worker.py|interview_worker.py) exec sleep 30 ;;\n'
                '  -c) exit 0 ;;\n'
                '  *) exit 99 ;;\n'
                'esac\n'
            )
            fake_python.chmod(0o755)
            environment = os.environ.copy()
            environment["GATEWAY_EXIT_CODE"] = str(gateway_exit_code)
            if terminate:
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
            return result, events, gateway_pid

    def test_failing_gateway_records_child_identity_and_normal_shutdown(self):
        result, events, gateway_pid = self.run_fake_supervisor(17)
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

    def test_sigterm_records_shutdown_reason(self):
        result, events, _ = self.run_fake_supervisor("hold", terminate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("gpu_peaks.py startup --stage shutdown --shutdown-reason sigterm", events)
        self.assertFalse(any("--stage child_exit" in event for event in events), events)

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
