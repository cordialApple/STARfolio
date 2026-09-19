import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from interview_worker import create_channel, create_local_stt_with_model


class Socket:
    def __init__(self):
        self.sent = []

    async def send_bytes(self, value):
        self.sent.append(value)


class Base:
    def __init__(self, server, ws, mimi=None):
        self.server, self.ws = server, ws
        self.output_queue = asyncio.Queue()
        self.turn_manager = SimpleNamespace(
            update_vad=lambda value: None, handle_spoken_text=lambda **kwargs: []
        )
        self.stt = SimpleNamespace(vad_callback=None)

    def _decode_text_token(self, token):
        return "question" if token == 4 else None

    async def _send_turn_outputs(self, outputs):
        pass


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_stt_uses_predownloaded_model(self):
        calls = []

        class Loaders:
            hf_hub_download = None

        class LocalSpeechToText:
            def __init__(self, mimi, **kwargs):
                calls.append(
                    (
                        mimi,
                        kwargs,
                        Loaders.hf_hub_download(kwargs["hf_repo"], "config.json"),
                    )
                )

        with tempfile.TemporaryDirectory() as directory:
            model_root = Path(directory)
            config = model_root / "config.json"
            config.write_text("{}")
            PinnedSpeechToText = create_local_stt_with_model(
                LocalSpeechToText, Loaders, model_root
            )
            PinnedSpeechToText("mimi", device="cuda:0")
        self.assertEqual(
            calls,
            [
                (
                    "mimi",
                    {"hf_repo": "kyutai/stt-1b-en_fr-candle", "device": "cuda:0"},
                    str(config),
                )
            ],
        )

    async def test_model_tokens_use_model_frames_not_candidate_asr(self):
        async def encode(**kwargs):
            return None

        Channel = create_channel(Base, object, encode)
        socket = Socket()
        channel = Channel(
            SimpleNamespace(
                mimi_copy=SimpleNamespace(frame_rate=12.5),
                runner=SimpleNamespace(mimi=SimpleNamespace(frame_rate=12.5)),
            ),
            socket,
        )
        channel.output_queue.put_nowait(None)
        await channel.output_queue.get()
        channel._decode_text_token(4)
        await channel.flush_model(False)
        event = json.loads(socket.sent[-1][1:])
        self.assertEqual(event["speaker"], "interviewer")
        self.assertEqual((event["startMs"], event["endMs"]), (0, 80))
        self.assertFalse(event["truncated"])

    async def test_candidate_barge_in_marks_pending_model_tail(self):
        async def encode(**kwargs):
            return None

        Channel = create_channel(Base, object, encode)
        socket = Socket()
        channel = Channel(
            SimpleNamespace(
                runner=SimpleNamespace(mimi=SimpleNamespace(frame_rate=12.5))
            ),
            socket,
        )
        channel.output_queue.put_nowait(None)
        await channel.output_queue.get()
        channel._decode_text_token(4)
        await channel.flush_model(True)
        self.assertTrue(json.loads(socket.sent[-1][1:])["truncated"])

    async def test_candidate_transcript_uses_asr_timestamp_and_gap_waits_for_silence(
        self,
    ):
        class Word:
            text = " candidate answer"
            start_time = 0.32

        class Speech:
            async def __aiter__(self):
                yield Word()

        async def encode(**kwargs):
            return None

        Channel = create_channel(Base, Word, encode)
        socket = Socket()
        server = SimpleNamespace(
            runner=SimpleNamespace(mimi=SimpleNamespace(frame_rate=12.5)),
            vad_threshold=0.5,
            vad_window_size=4,
            stt_wait_steps=0,
        )
        channel = Channel(server, socket)
        vad = channel.stt.vad_callback
        channel.stt = Speech()
        await channel._stt_recv_loop()
        self.assertEqual(socket.sent, [])
        await channel.flush_candidate(False)
        event = json.loads(socket.sent[-1][1:])
        self.assertEqual(
            event,
            {
                "type": "segment",
                "speaker": "candidate",
                "text": " candidate answer",
                "startMs": 320,
                "endMs": 400,
                "truncated": False,
            },
        )
        for _ in range(4):
            vad(0.9)
        await asyncio.sleep(0.05)
        vad(0.1)
        await asyncio.sleep(0.22)
        self.assertFalse(
            any(json.loads(value[1:])["type"] == "gap" for value in socket.sent)
        )
        for _ in range(4):
            vad(0.9)
        await asyncio.sleep(0.23)
        self.assertEqual(json.loads(socket.sent[-1][1:]), {"type": "gap", "atMs": 400})

    async def test_model_subwords_aggregate_until_pause_or_gap(self):
        async def encode(**kwargs):
            return None

        Channel = create_channel(Base, object, encode)
        socket = Socket()
        channel = Channel(
            SimpleNamespace(
                runner=SimpleNamespace(mimi=SimpleNamespace(frame_rate=12.5))
            ),
            socket,
        )
        for _ in range(3):
            channel.output_queue.put_nowait(None)
            await channel.output_queue.get()
            channel._decode_text_token(4)
        await asyncio.sleep(0)
        self.assertEqual(socket.sent, [])
        await channel.flush_model(False)
        event = json.loads(socket.sent[-1][1:])
        self.assertEqual(event["text"], "questionquestionquestion")
        self.assertEqual((event["startMs"], event["endMs"]), (0, 240))

    async def test_finish_advances_delayed_asr_without_feeding_moshi(self):
        class Word:
            text = " final delayed evidence"
            start_time = 0.64

        class DelayedSpeech:
            def __init__(self):
                self.mimi = SimpleNamespace(sample_rate=24000, frame_rate=12.5)
                self._lm_gen = SimpleNamespace(lm_model=SimpleNamespace(delays=[0, 4]))
                self._out_queue = asyncio.Queue()
                self.frames = 0

            async def send_audio(self, pcm):
                self.frames += 1
                if self.frames == 4:
                    self._out_queue.put_nowait(Word())

            async def __aiter__(self):
                while True:
                    yield await self._out_queue.get()

        async def encode(**kwargs):
            return None

        Channel = create_channel(Base, Word, encode)
        socket = Socket()
        channel = Channel(
            SimpleNamespace(
                runner=SimpleNamespace(mimi=SimpleNamespace(frame_rate=12.5))
            ),
            socket,
        )
        channel.input_queue = asyncio.Queue()
        channel.stt = DelayedSpeech()
        reader = asyncio.create_task(channel._stt_recv_loop())
        try:
            await channel.finish_transcript()
            events = [json.loads(value[1:]) for value in socket.sent]
            self.assertEqual(events[0]["text"], " final delayed evidence")
            self.assertEqual(events[-1], {"type": "flushed", "complete": True})
            self.assertGreaterEqual(channel.stt.frames, 4)
            self.assertTrue(channel.input_queue.empty())
            self.assertEqual(channel.output_queue.frames, 0)
        finally:
            reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)

    async def test_unknown_asr_drain_cannot_claim_complete(self):
        async def encode(**kwargs):
            return None

        Channel = create_channel(Base, object, encode)
        socket = Socket()
        channel = Channel(
            SimpleNamespace(
                runner=SimpleNamespace(mimi=SimpleNamespace(frame_rate=12.5))
            ),
            socket,
        )
        channel.input_queue = asyncio.Queue()
        await channel.finish_transcript()
        self.assertEqual(
            json.loads(socket.sent[-1][1:]), {"type": "flushed", "complete": False}
        )

    async def test_finish_waits_for_inflight_asr_after_full_segment(self):
        class Word:
            text = " final"
            start_time = 1

        class Speech:
            def __init__(self):
                self.mimi = SimpleNamespace(sample_rate=24000, frame_rate=12.5)
                self._lm_gen = SimpleNamespace(lm_model=SimpleNamespace(delays=[0]))
                self._out_queue = asyncio.Queue()
                self._out_queue.put_nowait(Word())

            async def send_audio(self, pcm):
                pass

            async def __aiter__(self):
                while True:
                    yield await self._out_queue.get()

        class DelayedSocket(Socket):
            def __init__(self):
                super().__init__()
                self.segment_started = asyncio.Event()
                self.release_segment = asyncio.Event()

            async def send_bytes(self, value):
                event = json.loads(value[1:])
                if event.get("type") == "segment" and len(event["text"]) == 2000:
                    self.segment_started.set()
                    await self.release_segment.wait()
                await super().send_bytes(value)

        async def encode(**kwargs):
            return None

        Channel = create_channel(Base, Word, encode)
        socket = DelayedSocket()
        channel = Channel(
            SimpleNamespace(
                runner=SimpleNamespace(mimi=SimpleNamespace(frame_rate=12.5))
            ),
            socket,
        )
        channel.input_queue = asyncio.Queue()
        channel.stt = Speech()
        channel.pending_candidate = {
            "type": "segment",
            "speaker": "candidate",
            "text": "x" * 2000,
            "startMs": 0,
            "endMs": 80,
            "truncated": False,
        }
        reader = asyncio.create_task(channel._stt_recv_loop())
        await socket.segment_started.wait()
        finish = asyncio.create_task(channel.finish_transcript())
        await asyncio.sleep(0.05)
        self.assertFalse(finish.done())
        socket.release_segment.set()
        try:
            await finish
            events = [json.loads(value[1:]) for value in socket.sent]
            self.assertEqual(
                [event.get("text") for event in events if event["type"] == "segment"],
                ["x" * 2000, " final"],
            )
            self.assertEqual(events[-1], {"type": "flushed", "complete": True})
        finally:
            reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)


if __name__ == "__main__":
    unittest.main()
