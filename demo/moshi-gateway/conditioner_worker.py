import os
from pathlib import Path

ARC_REPOSITORY = "kyutai/ARC4_Encoder_Llama"


def resolve_arc_model_file(repository, filename, model_root):
    if repository != ARC_REPOSITORY or filename != "model.safetensors":
        raise ValueError("Unexpected ARC model request")
    path = Path(model_root) / filename
    if not path.is_file():
        raise ValueError("Pinned ARC model is missing")
    return str(path)


def main():
    from moshi import server_conditioner
    from moshi.conditioners import arc_encoder

    model_root = Path(os.environ["STARFOLIO_ARC_MODEL_PATH"])
    arc_encoder.hf_hub_download = lambda repository, filename: resolve_arc_model_file(
        repository,
        filename,
        model_root,
    )
    server_conditioner.main()


if __name__ == "__main__":
    main()
