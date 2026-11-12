import os
from types import SimpleNamespace


def main():
    from interview_worker import prepare_interview_server

    os.environ["STARFOLIO_STT_MODEL_PATH"] = "/startup-smoke-no-model-load"
    tracker = SimpleNamespace(cuda=None, set_phase=lambda phase: None)
    prepare_interview_server(tracker)
    print("STARTUP_BINDINGS_OK")


if __name__ == "__main__":
    main()
