from pathlib import Path
from types import SimpleNamespace


def apply_bindings(server, channel_module, stt, loaders, encode, model_root, tracker, worker):
    channel_module.LocalSpeechToText = worker.create_local_stt_with_model(
        stt.LocalSpeechToText, loaders, model_root
    )
    worker.track_interview_lifecycle(server, tracker)
    server.Channel = worker.create_channel(
        channel_module.Channel, stt.STTWordMessage, encode, tracker=tracker
    )
    if not issubclass(channel_module.LocalSpeechToText, stt.LocalSpeechToText):
        raise RuntimeError("STT binding did not preserve upstream type")
    if not issubclass(server.Channel, channel_module.Channel):
        raise RuntimeError("Server binding did not preserve upstream type")


def main():
    from moshi import server, stt
    from moshi.inference_utils import channel as channel_module
    from moshi.inference_utils.utils import get_conditioning_remote_async
    from moshi.models import loaders
    import interview_worker

    tracker = SimpleNamespace(set_phase=lambda phase: None)
    apply_bindings(
        server,
        channel_module,
        stt,
        loaders,
        get_conditioning_remote_async,
        Path("/startup-smoke-no-model-load"),
        tracker,
        interview_worker,
    )
    print("STARTUP_BINDINGS_OK")


if __name__ == "__main__":
    main()
