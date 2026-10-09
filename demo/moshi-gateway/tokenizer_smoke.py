import json
import os
import sys
from pathlib import Path


def check_tokenizer(config_path, expected_dir, load_tokenizer):
    model_dir = Path(expected_dir)
    config = json.loads(Path(config_path).read_text())
    configured_dir = config["conditioners"]["reference_with_time"]["multi_arc_encoder"]["tokenizer_name"]
    if configured_dir != str(model_dir):
        raise ValueError("Unexpected tokenizer path")
    required_assets = (
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "original/tokenizer.model",
    )
    for name in required_assets:
        asset = model_dir / name
        if not asset.is_file() or asset.stat().st_size == 0:
            raise ValueError("Tokenizer asset missing")
    tokenizer = load_tokenizer(
        str(model_dir), use_fast=False, local_files_only=True, trust_remote_code=False
    )
    if not isinstance(tokenizer.vocab_size, int) or tokenizer.vocab_size < 1:
        raise ValueError("Tokenizer vocabulary invalid")
    if not isinstance(tokenizer.bos_token_id, int) or not isinstance(tokenizer.eos_token_id, int):
        raise ValueError("Tokenizer boundaries invalid")
    tokens = tokenizer.encode("tokenizer smoke", add_special_tokens=False)
    if not isinstance(tokens, list) or not tokens or not all(isinstance(token, int) for token in tokens):
        raise ValueError("Tokenizer encoding invalid")
    decoded = tokenizer.decode(tokens)
    if not isinstance(decoded, str) or not decoded:
        raise ValueError("Tokenizer decoding invalid")


def main():
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    try:
        if len(sys.argv) != 3:
            return 1
        from transformers import AutoTokenizer

        check_tokenizer(sys.argv[1], sys.argv[2], AutoTokenizer.from_pretrained)
    except Exception:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
