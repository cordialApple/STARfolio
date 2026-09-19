import asyncio
import contextlib
import json
import os
from pathlib import Path

import aiohttp
import numpy as np
from interview_protocol import (
    CONTROL_PREFIX,
    InterviewConditioning,
    encode_control_event,
)

STT_REPOSITORY = "kyutai/stt-1b-en_fr-candle"
MAX_SEGMENT_CHARACTERS = 2000


def create_local_stt_with_model(base, loaders, model_root):
    class LocalSpeechToText(base):
        def __init__(self, mimi, **kwargs):
            original_download = loaders.hf_hub_download

            def load_model_file(repository, filename, revision=None):
                if repository != STT_REPOSITORY:
                    return original_download(repository, filename, revision=revision)
                path = Path(model_root) / filename
                if not path.is_file():
                    raise ValueError(f"Pinned STT model file is missing: {filename}")
                return str(path)

            loaders.hf_hub_download = load_model_file
            try:
                super().__init__(mimi, hf_repo=STT_REPOSITORY, **kwargs)
            finally:
                loaders.hf_hub_download = original_download

    return LocalSpeechToText


class FrameQueue(asyncio.Queue):
    def __init__(self):
        super().__init__()
        self.frames = 0

    async def get(self):
        result = await super().get()
        self.frames += 1
        return result


class ControlSocket:
    def __init__(self, socket, channel):
        self.socket, self.channel = socket, channel

    def __getattr__(self, key):
        return getattr(self.socket, key)

    async def send_bytes(self, value):
        await self.socket.send_bytes(value)
        if value == b"\x00":
            await self.channel.send_event(
                {"type": "interview-capabilities", "version": 1}
            )

    async def __aiter__(self):
        async for message in self.socket:
            if (
                message.type == aiohttp.WSMsgType.BINARY
                and message.data[:1] == CONTROL_PREFIX
            ):
                value = json.loads(message.data[1:])
                if value.get("type") == "conditioning":
                    self.channel.spawn(
                        self.channel.conditioning.update(value["context"])
                    )
                    continue
                if value.get("type") == "finish":
                    await self.channel.finish_transcript()
                    continue
            yield message


def create_channel(base, word_type, encode):
    class InterviewChannel(base):
        def __init__(self, server, ws, mimi=None):
            super().__init__(server, ws, mimi=mimi)
            self.ws = ControlSocket(ws, self)
            self.output_queue = FrameQueue()
            self.frame_ms = 1000 / server.runner.mimi.frame_rate
            self.closing = False
            self.draining = False
            self.pending_candidate = None
            self.pending_model = None
            self.model_timer = None
            self.gap_timer = None
            self.candidate_active = False
            self.candidate_spoke = False
            self.vad_silent = 0
            self.tasks = set()
            self.asr_messages_inflight = 0
            self.latest_candidate_ms = 0
            self.conditioning = InterviewConditioning(
                self.encode_context, self.apply_context, self.send_event
            )
            original_vad = self.turn_manager.update_vad

            def update_vad(value):
                original_vad(value)
                if self.draining:
                    return
                if value <= server.vad_threshold:
                    self.vad_silent = 0
                    if self.gap_timer:
                        self.gap_timer.cancel()
                        self.gap_timer = None
                    if not self.candidate_active:
                        self.candidate_active = True
                        self.spawn(self.flush_model(True))
                else:
                    self.vad_silent += 1
                    if self.vad_silent >= server.vad_window_size:
                        self.candidate_active = False
                    if (
                        self.candidate_spoke
                        and self.vad_silent >= server.vad_window_size
                        and self.gap_timer is None
                    ):
                        self.gap_timer = self.spawn(self.emit_gap())

            self.stt.vad_callback = update_vad

        def spawn(self, coroutine):
            task = asyncio.create_task(coroutine)
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)
            task.add_done_callback(self.check_task)
            return task

        def check_task(self, task):
            if not task.cancelled() and task.exception() is not None:
                self.spawn(self.ws.close())

        async def send_event(self, event):
            if event.get("type") == "segment" and not event["text"].strip():
                return
            await self.ws.socket.send_bytes(encode_control_event(event))

        async def encode_context(self, text):
            return await asyncio.wait_for(
                encode(text=text, encoder_url=self.server.reference_encoder_url), 120
            )

        def apply_context(self, encoded):
            updates = [None] * self.server.batch_size
            updates[self.slot_idx] = encoded.squeeze(0)
            self.server.runner.lm_gen.update_streaming_sum_tensors(updates)

        async def _async_update_reference(self, reference_text):
            return

        async def _stt_recv_loop(self):
            async for message in self.stt:
                self.asr_messages_inflight += 1
                try:
                    if isinstance(message, word_type) and not self.closing:
                        self.candidate_spoke = True
                        start = max(0, round(message.start_time * 1000))
                        self.latest_candidate_ms = start + round(self.frame_ms)
                        if (
                            self.pending_candidate
                            and len(self.pending_candidate["text"]) + len(message.text)
                            > MAX_SEGMENT_CHARACTERS
                        ):
                            await self.flush_candidate(False)
                        if self.pending_candidate:
                            self.pending_candidate["text"] += message.text
                            self.pending_candidate["endMs"] = self.latest_candidate_ms
                        else:
                            self.pending_candidate = {
                                "type": "segment",
                                "speaker": "candidate",
                                "text": message.text,
                                "startMs": start,
                                "endMs": self.latest_candidate_ms,
                                "truncated": False,
                            }
                        await self._send_turn_outputs(
                            self.turn_manager.handle_spoken_text(user_text=message.text)
                        )
                finally:
                    self.asr_messages_inflight -= 1

        def _decode_text_token(self, token):
            text = super()._decode_text_token(token)
            if text and not self.closing:
                previous = self.pending_model
                start = max(0, round((self.output_queue.frames - 1) * self.frame_ms))
                if (
                    previous
                    and len(previous["text"]) + len(text) <= MAX_SEGMENT_CHARACTERS
                ):
                    previous["text"] += text
                    previous["endMs"] = start + round(self.frame_ms)
                else:
                    self.pending_model = {
                        "type": "segment",
                        "speaker": "interviewer",
                        "text": text,
                        "startMs": start,
                        "endMs": start + round(self.frame_ms),
                        "truncated": False,
                    }
                    if previous:
                        self.spawn(self.send_event(previous))
                if self.model_timer:
                    self.model_timer.cancel()
                self.model_timer = self.spawn(self.flush_model_later())
            return text

        async def flush_model_later(self):
            await asyncio.sleep(0.4)
            await self.flush_model(False)

        async def flush_model(self, truncated):
            segment, self.pending_model = self.pending_model, None
            if segment:
                segment["truncated"] = truncated
                await self.send_event(segment)

        async def flush_candidate(self, truncated):
            segment, self.pending_candidate = self.pending_candidate, None
            if segment:
                segment["truncated"] = truncated
                await self.send_event(segment)

        async def flush_transcript(self, truncated):
            if self.pending_candidate and (
                not self.pending_model
                or self.pending_candidate["startMs"] <= self.pending_model["startMs"]
            ):
                await self.flush_candidate(truncated)
                await self.flush_model(truncated)
            else:
                await self.flush_model(truncated)
                await self.flush_candidate(truncated)

        async def emit_gap(self):
            await asyncio.sleep(
                max(0.2, self.server.stt_wait_steps * self.frame_ms / 1000 + 0.08)
            )
            await self.flush_transcript(False)
            if self.candidate_spoke:
                self.candidate_spoke = False
                await self.send_event(
                    {
                        "type": "gap",
                        "atMs": max(
                            self.latest_candidate_ms,
                            round(self.output_queue.frames * self.frame_ms),
                        ),
                    }
                )
            self.gap_timer = None

        async def drain_asr(self, deadline):
            decoder = getattr(self.stt, "_lm_gen", None)
            delays = getattr(getattr(decoder, "lm_model", None), "delays", None)
            mimi = getattr(self.stt, "mimi", None)
            queue = getattr(self.stt, "_out_queue", None)
            if not delays or mimi is None or queue is None:
                return False
            frame_samples = int(mimi.sample_rate / mimi.frame_rate)
            pending = getattr(self, "_all_pcm_data", None)
            if pending is not None and len(pending):
                await self.stt.send_audio(pending)
                self._all_pcm_data = None
            for _ in range(max(delays) + 2):
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    return False
                await asyncio.wait_for(
                    self.stt.send_audio(np.zeros(frame_samples, dtype=np.float32)),
                    remaining,
                )
                await asyncio.sleep(0)
            while (
                not queue.empty() or self.asr_messages_inflight
            ) and asyncio.get_running_loop().time() < deadline:
                await asyncio.sleep(0.01)
            await asyncio.sleep(0)
            return queue.empty() and not self.asr_messages_inflight

        async def finish_transcript(self):
            self.draining = True
            self.conditioning.close()
            if self.gap_timer:
                self.gap_timer.cancel()
            deadline = asyncio.get_running_loop().time() + 2
            while (
                not self.input_queue.empty() or not self.output_queue.empty()
            ) and asyncio.get_running_loop().time() < deadline:
                await asyncio.sleep(0.02)
            complete = False
            try:
                complete = await self.drain_asr(deadline)
            except (TimeoutError, ValueError, RuntimeError, ConnectionError):
                pass
            self.closing = True
            await self.flush_transcript(True)
            await self.send_event(
                {
                    "type": "flushed",
                    "complete": complete
                    and self.input_queue.empty()
                    and self.output_queue.empty(),
                }
            )

        async def run(self):
            try:
                await super().run()
            finally:
                self.conditioning.close()
                for task in tuple(self.tasks):
                    task.cancel()
                await asyncio.gather(*self.tasks, return_exceptions=True)
                with contextlib.suppress(ConnectionError):
                    await self.flush_transcript(True)

    return InterviewChannel


def main():
    from moshi import server
    from moshi.inference_utils import channel as channel_module
    from moshi.inference_utils.channel import Channel
    from moshi.inference_utils.utils import get_conditioning_remote_async
    from moshi.models import loaders
    from moshi.stt import LocalSpeechToText, STTWordMessage

    channel_module.LocalSpeechToText = create_local_stt_with_model(
        LocalSpeechToText,
        loaders,
        Path(os.environ["STARFOLIO_STT_MODEL_PATH"]),
    )
    server.Channel = create_channel(
        Channel, STTWordMessage, get_conditioning_remote_async
    )
    server.main()


if __name__ == "__main__":
    main()
