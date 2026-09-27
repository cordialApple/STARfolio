import os
from pathlib import Path

from gpu_peaks import PeakTracker

ARC_REPOSITORY = "kyutai/ARC4_Encoder_Llama"


def resolve_arc_model_file(repository, filename, model_root):
    if repository != ARC_REPOSITORY or filename != "model.safetensors":
        raise ValueError("Unexpected ARC model request")
    path = Path(model_root) / filename
    if not path.is_file():
        raise ValueError("Pinned ARC model is missing")
    return str(path)


def track_conditioner_lifecycle(server, tracker):
    original_init = server.EncoderService.__init__
    original_encode = server.EncoderService.encode

    def initialize(service, *args, **kwargs):
        tracker.set_phase("model_load")
        result = original_init(service, *args, **kwargs)
        tracker.set_phase("serving")
        return result

    def encode(service, *args, **kwargs):
        tracker.set_phase("session_active")
        try:
            return original_encode(service, *args, **kwargs)
        except Exception as error:
            tracker.record_failure(error)
            raise
        finally:
            tracker.set_phase("serving")

    server.EncoderService.__init__ = initialize
    server.EncoderService.encode = encode


def main():
    with PeakTracker("conditioner") as tracker:
        from moshi import server_conditioner
        from moshi.conditioners import arc_encoder

        model_root = Path(os.environ["STARFOLIO_ARC_MODEL_PATH"])
        arc_encoder.hf_hub_download = lambda repository, filename: resolve_arc_model_file(
            repository,
            filename,
            model_root,
        )
        track_conditioner_lifecycle(server_conditioner, tracker)
        server_conditioner.main()


if __name__ == "__main__":
    main()
