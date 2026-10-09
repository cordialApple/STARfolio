import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

SMOKE = Path(__file__).with_name("startup_smoke.py")


class StartupSmokeTests(unittest.TestCase):
    def test_applies_bindings_without_loading_models(self):
        self.assertTrue(SMOKE.is_file())
        spec = importlib.util.spec_from_file_location("startup_smoke", SMOKE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        class ChannelBase:
            pass

        class SpeechBase:
            pass

        def fail_if_loaded(*args, **kwargs):
            self.fail("Model loading or warmup was called")

        server = SimpleNamespace(
            Channel=ChannelBase,
            load_models=fail_if_loaded,
            ServerState=SimpleNamespace(warmup=fail_if_loaded),
        )
        channel_module = SimpleNamespace(Channel=ChannelBase)
        stt = SimpleNamespace(LocalSpeechToText=SpeechBase, STTWordMessage=object)
        loaders = object()
        tracker = object()
        model_root = Path("unused-model-root")
        calls = []

        def create_stt(base, dependency, path):
            calls.append(("stt", base, dependency, path))
            return type("PinnedSpeech", (base,), {})

        def track_lifecycle(module, observer):
            calls.append(("lifecycle", module, observer))

        def create_channel(base, word_type, encode, tracker):
            calls.append(("channel", base, word_type, encode, tracker))
            return type("InterviewChannel", (base,), {})

        def encode():
            return None

        worker = SimpleNamespace(
            create_local_stt_with_model=create_stt,
            track_interview_lifecycle=track_lifecycle,
            create_channel=create_channel,
        )
        module.apply_bindings(
            server, channel_module, stt, loaders, encode, model_root, tracker, worker
        )
        self.assertTrue(issubclass(channel_module.LocalSpeechToText, SpeechBase))
        self.assertTrue(issubclass(server.Channel, ChannelBase))
        self.assertEqual(calls, [
            ("stt", SpeechBase, loaders, model_root),
            ("lifecycle", server, tracker),
            ("channel", ChannelBase, object, encode, tracker),
        ])


if __name__ == "__main__":
    unittest.main()
