import tempfile
import unittest
from pathlib import Path

from conditioner_worker import resolve_arc_model_file


class ConditionerWorkerTests(unittest.TestCase):
    def test_arc_loader_accepts_only_local_pinned_weight(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            weight = root / "model.safetensors"
            weight.write_bytes(b"weights")
            self.assertEqual(
                resolve_arc_model_file(
                    "kyutai/ARC4_Encoder_Llama", "model.safetensors", root
                ),
                str(weight),
            )
            for repository, filename in (
                ("other/model", "model.safetensors"),
                ("kyutai/ARC4_Encoder_Llama", "../model.safetensors"),
            ):
                with (
                    self.subTest(repository=repository, filename=filename),
                    self.assertRaises(ValueError),
                ):
                    resolve_arc_model_file(repository, filename, root)


if __name__ == "__main__":
    unittest.main()
