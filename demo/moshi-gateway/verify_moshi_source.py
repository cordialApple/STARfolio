import ast
import sys
from pathlib import Path


CONTRACTS = {
    "server.py": {"classes": set(), "functions": set(), "tokens": {"Channel", "StepOutput"}},
    "inference_utils/channel.py": {
        "classes": {"Channel"},
        "functions": {
            "_async_update_reference",
            "_decode_text_token",
            "_stt_recv_loop",
        },
        "tokens": {"input_queue", "output_queue", "stt", "turn_manager"},
    },
    "inference_utils/utils.py": {
        "classes": set(),
        "functions": {"get_conditioning_remote_async"},
        "tokens": set(),
    },
    "models/loaders.py": {
        "classes": set(),
        "functions": set(),
        "tokens": {"hf_hub_download"},
    },
    "stt/__init__.py": {
        "classes": set(),
        "functions": set(),
        "tokens": {"LocalSpeechToText", "STTWordMessage"},
    },
    "server_conditioner.py": {
        "classes": set(),
        "functions": {"main"},
        "tokens": {"loaders", "get_conditioner_provider"},
    },
    "conditioners/arc_encoder.py": {
        "classes": set(),
        "functions": set(),
        "tokens": {"hf_hub_download"},
    },
}


def defined_names(tree):
    classes = {node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef)}
    functions = {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    return classes, functions


def verify_source(root):
    failures = []
    for relative_path, contract in CONTRACTS.items():
        path = root / relative_path
        if not path.is_file():
            failures.append(f"missing {relative_path}")
            continue
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
        classes, functions = defined_names(tree)
        for name in sorted(contract["classes"] - classes):
            failures.append(f"{relative_path} missing class {name}")
        for name in sorted(contract["functions"] - functions):
            failures.append(f"{relative_path} missing function {name}")
        for token in sorted(contract["tokens"]):
            if token not in source:
                failures.append(f"{relative_path} missing token {token}")
    return failures


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_moshi_source.py PATH")
    failures = verify_source(Path(sys.argv[1]))
    if failures:
        raise SystemExit("Moshi source contract mismatch:\n" + "\n".join(failures))


if __name__ == "__main__":
    main()
