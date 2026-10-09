import importlib.util
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP = ROOT / "demo" / "moshi-gateway" / "bootstrap.sh"
RUN_WORKER = ROOT / "demo" / "moshi-gateway" / "run-worker.sh"
BUILD_LOCK = ROOT / "demo" / "moshi-gateway" / "requirements-build.lock"
RUNTIME_INPUT = ROOT / "demo" / "moshi-gateway" / "requirements-runtime.in"
RUNTIME_LOCK = ROOT / "demo" / "moshi-gateway" / "requirements.lock"
WORKFLOW = ROOT / ".github" / "workflows" / "aws-demo.yml"
SOURCE_REVISION = "8c6dfc101b7871baa428424bcdc583b74fb561d9"
MOSHIKA_REVISION = "7135a6e3c46abb66c2cd95cb04cbfcbe8376f83d"
STT_REVISION = "095e38f6242006a93c2541149b181988397f5c7c"
ARC_REVISION = "c11e53d1016cc586262ee883755410e2ca47ba3c"
TOKENIZER_REVISION = "0cb88a4f764b7a12671c53f0838cd831a0843b95"
TOKENIZER_SMOKE = ROOT / "demo" / "moshi-gateway" / "tokenizer_smoke.py"
STARTUP_SMOKE = ROOT / "demo" / "moshi-gateway" / "startup_smoke.py"


def load_tokenizer_smoke():
    if not TOKENIZER_SMOKE.is_file():
        raise AssertionError("Tokenizer smoke helper missing")
    spec = importlib.util.spec_from_file_location("tokenizer_smoke", TOKENIZER_SMOKE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_tokenizer_fixture(root):
    model_dir = root / "llama-tokenizer"
    (model_dir / "original").mkdir(parents=True)
    for name in ("tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"):
        (model_dir / name).write_text("{}")
    (model_dir / "original" / "tokenizer.model").write_bytes(b"tokenizer fixture")
    config_path = root / "config.json"
    config_path.write_text(
        json.dumps({
            "conditioners": {
                "reference_with_time": {
                    "multi_arc_encoder": {"tokenizer_name": str(model_dir)}
                }
            }
        })
    )
    return config_path, model_dir


class RuntimeInputTests(unittest.TestCase):
    def test_moshirag_source_uses_full_commit(self):
        script = BOOTSTRAP.read_text()
        self.assertIn(SOURCE_REVISION, script)
        self.assertRegex(
            script,
            rf"git .*fetch .*{SOURCE_REVISION}|git .*checkout .*{SOURCE_REVISION}",
        )

    def test_hugging_face_snapshots_use_full_revisions(self):
        script = BOOTSTRAP.read_text()
        for repository, revision in (
            ("kyutai/moshika-rag-pytorch-bf16", MOSHIKA_REVISION),
            ("kyutai/stt-1b-en_fr-candle", STT_REVISION),
            ("kyutai/ARC4_Encoder_Llama", ARC_REVISION),
            ("meta-llama/Llama-3.2-3B-Instruct", TOKENIZER_REVISION),
        ):
            with self.subTest(repository=repository):
                self.assertIn(repository, script)
                self.assertIn(revision, script)
        self.assertEqual(len(re.findall(r'revision=["\']?[0-9a-f]{40}', script)), 4)

    def test_worker_loads_only_predownloaded_models(self):
        script = RUN_WORKER.read_text()
        self.assertNotIn("hf://", script)
        self.assertNotIn("snapshot_download", script)
        self.assertIn("HF_HUB_OFFLINE=1", script)
        self.assertIn("TRANSFORMERS_OFFLINE=1", script)
        self.assertIn("STARFOLIO_STT_MODEL_PATH=", script)
        self.assertIn("STARFOLIO_ARC_MODEL_PATH=", script)
        for filename in (
            "config.json",
            "model.safetensors",
            "tokenizer-e351c8d8-checkpoint125.safetensors",
            "tokenizer_spm_32k_3.model",
        ):
            with self.subTest(filename=filename):
                self.assertIn(filename, script)
        bootstrap = BOOTSTRAP.read_text()
        self.assertIn("llama-tokenizer", bootstrap)
        self.assertIn("original/tokenizer.model", bootstrap)

    def test_bootstrap_installs_hash_locked_dependencies(self):
        script = BOOTSTRAP.read_text()
        self.assertIn("pip install --require-hashes", script)
        self.assertIn("--only-binary=:all:", script)
        self.assertIn("requirements.lock", script)
        self.assertIn("requirements-build.lock", script)
        self.assertIn(
            "pip install --no-build-isolation --no-deps /opt/starfolio-runtime/moshi-rag/moshi",
            script,
        )
        build_lock = BUILD_LOCK.read_text()
        self.assertRegex(
            build_lock,
            r"hatchling==\d+\.\d+\.\d+ \\\n(?:    --hash=sha256:[0-9a-f]{64} \\\n)+",
        )

    def test_upstream_channel_dependency_is_hash_locked(self):
        self.assertIn("websockets==15.0.1", RUNTIME_INPUT.read_text().splitlines())
        self.assertRegex(
            RUNTIME_LOCK.read_text(),
            r"(?m)^websockets==15\.0\.1 \\\n(?:    --hash=sha256:[0-9a-f]{64}(?: \\\n|\n))+",
        )

    def test_upstream_http_client_dependency_is_hash_locked(self):
        self.assertIn("httpx==0.28.1", RUNTIME_INPUT.read_text().splitlines())
        self.assertRegex(
            RUNTIME_LOCK.read_text(),
            r"(?m)^httpx==0\.28\.1 \\\n(?:    --hash=sha256:[0-9a-f]{64}(?: \\\n|\n))+",
        )

    def test_ci_imports_upstream_server_in_locked_runtime(self):
        workflow = WORKFLOW.read_text()
        create = "python -m venv /tmp/moshi-runtime"
        install = (
            "/tmp/moshi-runtime/bin/python -m pip install --require-hashes "
            "--only-binary=:all: -r demo/moshi-gateway/requirements.lock"
        )
        wheel = "/tmp/moshi-runtime/bin/python -m pip install --no-deps /tmp/moshi-wheel/*.whl"
        smoke = '/tmp/moshi-runtime/bin/python -c "import moshi.server"'
        for command in (create, install, wheel, smoke):
            self.assertIn(command, workflow)
        self.assertLess(workflow.index(create), workflow.index(install))
        self.assertLess(workflow.index(install), workflow.index(wheel))
        self.assertLess(workflow.index(wheel), workflow.index(smoke))

    def test_ci_applies_startup_bindings_without_model_load(self):
        workflow = WORKFLOW.read_text()
        self.assertTrue(STARTUP_SMOKE.is_file())
        script = STARTUP_SMOKE.read_text()
        command = "/tmp/moshi-runtime/bin/python demo/moshi-gateway/startup_smoke.py"
        self.assertIn(command, workflow)
        self.assertLess(
            workflow.index('/tmp/moshi-runtime/bin/python -c "import moshi.server"'),
            workflow.index(command),
        )
        self.assertNotIn("server.main()", script)
        self.assertNotIn("server.load_models()", script)

    def test_ci_validates_production_inputs_and_generated_infrastructure(self):
        workflow = WORKFLOW.read_text()
        self.assertRegex(workflow, r"permissions:\s+contents: read")
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("requirements-build.in", workflow)
        self.assertIn("requirements-build.lock", workflow)
        self.assertIn("requirements-test.lock", workflow)
        self.assertIn(".github/requirements/aws-demo.lock", workflow)
        self.assertNotIn("pip install uv==", workflow)
        self.assertIn("--exclude-newer 2026-09-19T00:00:00Z", workflow)
        self.assertIn("git diff --exit-code", workflow)
        self.assertIn(SOURCE_REVISION, workflow)
        self.assertIn("pip wheel --no-build-isolation --no-deps", workflow)
        self.assertIn("pip install --no-deps /tmp/moshi-wheel/", workflow)
        self.assertIn("submodule_search_locations", workflow)
        self.assertIn("verify_moshi_source.py /tmp/moshi-rag/moshi/moshi", workflow)
        self.assertIn("bash -n /tmp/starfolio-user-data.sh", workflow)
        self.assertIn("cfn-lint /tmp/starfolio-template.json", workflow)
        self.assertIn("'hours':0.6666666666666666", workflow)

    def test_bootstrap_uses_secret_token_ephemerally(self):
        script = BOOTSTRAP.read_text()
        self.assertIn("secretsmanager get-secret-value", script)
        self.assertIn("export HF_TOKEN", script)
        self.assertIn("unset HF_TOKEN", script)
        self.assertNotIn('echo "$HF_TOKEN"', script)
        self.assertIn("Environment=STARFOLIO_DEMO_DEADLINE=", script)
        self.assertIn("IPAddressAllow=localhost", script)
        self.assertIn("IPAddressDeny=any", script)

    def test_gpu_sampler_starts_before_model_service_and_flushes_on_exit(self):
        bootstrap = BOOTSTRAP.read_text()
        self.assertIn("STARFOLIO_TRIAL_GPU_URI", bootstrap)
        self.assertIn("gpu_sampler.py", bootstrap)
        self.assertIn("starfolio-gpu-sampler.service", bootstrap)
        sampler_unit = bootstrap.split("cat > /etc/systemd/system/starfolio-gpu-sampler.service", 1)[1]
        sampler_unit = sampler_unit.split("cat > /etc/systemd/system/starfolio-demo.service", 1)[0]
        self.assertIn("TimeoutStopSec=45", sampler_unit)
        self.assertIn('graceful_remaining=$((remaining - 120))', bootstrap)
        self.assertIn('starfolio-host-deadline --on-active="${graceful_remaining}s"', bootstrap)
        self.assertLess(
            bootstrap.index("systemctl enable --now starfolio-gpu-sampler.service"),
            bootstrap.index("systemctl enable --now starfolio-demo.service"),
        )
        self.assertIn("ExecStopPost=+/bin/bash", bootstrap)
        self.assertIn("stop-worker.sh", bootstrap)
        self.assertNotIn("ExecStopPost=-+/usr/bin/systemctl stop starfolio-gpu-sampler.service", bootstrap)
        self.assertNotIn("ExecStopPost=+/sbin/shutdown -h now", bootstrap)
        self.assertFalse((ROOT / "demo" / "moshi-gateway" / "diagnostics.sh").exists())

    def test_cloudwatch_agent_starts_before_model_service(self):
        bootstrap = BOOTSTRAP.read_text()
        self.assertIn("cloudwatch-gpu.json", bootstrap)
        self.assertIn("amazon-cloudwatch-agent-ctl", bootstrap)
        self.assertIn("--verify \"$cloudwatch_dir/amazon-cloudwatch-agent.deb.sig\"", bootstrap)
        self.assertLess(
            bootstrap.index("amazon-cloudwatch-agent-ctl"),
            bootstrap.index("systemctl enable --now starfolio-demo.service"),
        )

    def test_bootstrap_smokes_offline_tokenizer_before_model_service(self):
        bootstrap = BOOTSTRAP.read_text()
        self.assertIn("tokenizer_smoke.py", bootstrap)
        self.assertIn("HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1", bootstrap)
        self.assertIn("TOKENIZER_SMOKE_FAILED", bootstrap)
        self.assertIn("TOKENIZER_SMOKE_OK", bootstrap)
        self.assertIn("runuser -u starfolio-demo -- env", bootstrap)
        self.assertIn("PYTHONDONTWRITEBYTECODE=1", bootstrap)
        self.assertLess(
            bootstrap.index("mountpoint -q /run/starfolio-private"),
            bootstrap.index("tokenizer_smoke.py"),
        )
        self.assertLess(
            bootstrap.index("systemctl enable --now starfolio-gpu-sampler.service"),
            bootstrap.index("tokenizer_smoke.py"),
        )
        self.assertIn("gpu_peaks.py\" startup --stage tokenizer_smoke_failed", bootstrap)
        self.assertLess(
            bootstrap.index("tokenizer_smoke.py"),
            bootstrap.index("systemctl enable --now starfolio-demo.service"),
        )

    def test_failed_tokenizer_smoke_emits_status_and_stops_sampler(self):
        bash = shutil.which("bash")
        if os.name == "nt":
            bash = r"C:\Program Files\Git\bin\bash.exe"
        if not bash or not Path(bash).exists():
            self.skipTest("Bash unavailable")
        bootstrap = BOOTSTRAP.read_text()
        start = bootstrap.index("if runuser -u starfolio-demo -- env")
        end = bootstrap.index("systemctl enable --now starfolio-demo.service", start)
        block = bootstrap[start:end]
        prefix = (
            "set -euo pipefail\n"
            "if command -v cygpath >/dev/null; then TEST_DIR=$(cygpath -u \"$TEST_DIR\"); fi\n"
            "root=/fake\npy=/fake/python\nSTARFOLIO_TRIAL_ID=trial-1\n"
            "runuser() {\n"
            "  if [[ \"$*\" == *tokenizer_smoke.py* ]]; then\n"
            "    printf 'PRIVATE_SAMPLE\\n' >&2\n"
            "    return 1\n"
            "  fi\n"
            "  printf '%s\\n' \"$*\" > \"$TEST_DIR/status\"\n"
            "}\n"
            "systemctl() { printf '%s\\n' \"$*\" > \"$TEST_DIR/stop\"; }\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            environment = os.environ.copy()
            environment["TEST_DIR"] = directory
            result = subprocess.run(
                [bash, "-c", prefix + block], env=environment,
                capture_output=True, text=True, timeout=10,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "TOKENIZER_SMOKE_FAILED\n")
            self.assertNotIn("PRIVATE_SAMPLE", result.stderr)
            self.assertIn("--stage tokenizer_smoke_failed", (Path(directory) / "status").read_text())
            self.assertEqual((Path(directory) / "stop").read_text().strip(), "stop starfolio-gpu-sampler.service")

    def test_tokenizer_smoke_rejects_missing_asset_before_loading(self):
        smoke = load_tokenizer_smoke()
        with tempfile.TemporaryDirectory() as tmp:
            config_path, model_dir = write_tokenizer_fixture(Path(tmp))
            (model_dir / "tokenizer.json").unlink()
            with self.assertRaises(ValueError):
                smoke.check_tokenizer(config_path, model_dir, lambda **kwargs: self.fail("Tokenizer loaded"))

    def test_tokenizer_smoke_rejects_different_configured_path(self):
        smoke = load_tokenizer_smoke()
        with tempfile.TemporaryDirectory() as tmp:
            config_path, model_dir = write_tokenizer_fixture(Path(tmp))
            other_dir = Path(tmp) / "other-tokenizer"
            other_dir.mkdir()
            with self.assertRaises(ValueError):
                smoke.check_tokenizer(config_path, other_dir, lambda **kwargs: self.fail("Tokenizer loaded"))

    def test_tokenizer_smoke_uses_local_slow_loader_and_round_trip(self):
        smoke = load_tokenizer_smoke()
        with tempfile.TemporaryDirectory() as tmp:
            config_path, model_dir = write_tokenizer_fixture(Path(tmp))
            calls = []

            class FixtureTokenizer:
                vocab_size = 2
                bos_token_id = 0
                eos_token_id = 1

                def encode(self, value, add_special_tokens):
                    if add_special_tokens:
                        raise AssertionError("Special tokens requested")
                    return [len(value)]

                def decode(self, values):
                    return "fixture" if values else ""

            def load_tokenizer(path, **options):
                calls.append((path, options))
                return FixtureTokenizer()

            smoke.check_tokenizer(config_path, model_dir, load_tokenizer)
            self.assertEqual(calls, [
                (str(model_dir), {
                    "use_fast": False,
                    "local_files_only": True,
                    "trust_remote_code": False,
                })
            ])


if __name__ == "__main__":
    unittest.main()
