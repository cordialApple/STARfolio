import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP = ROOT / "demo" / "moshi-gateway" / "bootstrap.sh"
RUN_WORKER = ROOT / "demo" / "moshi-gateway" / "run-worker.sh"
BUILD_LOCK = ROOT / "demo" / "moshi-gateway" / "requirements-build.lock"
WORKFLOW = ROOT / ".github" / "workflows" / "aws-demo.yml"
SOURCE_REVISION = "8c6dfc101b7871baa428424bcdc583b74fb561d9"
MOSHIKA_REVISION = "7135a6e3c46abb66c2cd95cb04cbfcbe8376f83d"
STT_REVISION = "095e38f6242006a93c2541149b181988397f5c7c"
ARC_REVISION = "c11e53d1016cc586262ee883755410e2ca47ba3c"
TOKENIZER_REVISION = "0cb88a4f764b7a12671c53f0838cd831a0843b95"


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

    def test_bootstrap_uses_secret_token_ephemerally(self):
        script = BOOTSTRAP.read_text()
        self.assertIn("secretsmanager get-secret-value", script)
        self.assertIn("export HF_TOKEN", script)
        self.assertIn("unset HF_TOKEN", script)
        self.assertNotIn('echo "$HF_TOKEN"', script)
        self.assertIn("Environment=STARFOLIO_DEMO_DEADLINE=", script)
        self.assertIn("IPAddressAllow=localhost", script)
        self.assertIn("IPAddressDeny=any", script)


if __name__ == "__main__":
    unittest.main()
