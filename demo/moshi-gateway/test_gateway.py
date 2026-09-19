import asyncio
import json
import struct
import time
import unittest

from aiohttp import ClientSession, WSMsgType, web
from aiohttp.test_utils import TestServer
from gateway import (
    STATE,
    create_app,
    decode_text,
    resolve_deadline,
    select_reference,
    validate_start,
)

EVIDENCE = [
    {
        "id": "one",
        "title": "Checkout reliability",
        "text": "Reduced checkout failures 30 percent with retries.",
    }
]


class ContractTests(unittest.TestCase):
    def test_runtime_deadline_uses_earliest_safety_limit(self):
        self.assertEqual(
            resolve_deadline({"STARFOLIO_DEMO_MAX_SECONDS": "14400"}, 1000), 15400
        )
        self.assertEqual(
            resolve_deadline(
                {
                    "STARFOLIO_DEMO_DEADLINE": "1970-01-01T00:20:00Z",
                    "STARFOLIO_DEMO_MAX_SECONDS": "14400",
                },
                1000,
            ),
            1200,
        )

    def test_start_rejects_oversized_or_unbounded_sessions(self):
        for seconds in [0, -1, 1801, True, float("nan")]:
            with self.assertRaises(ValueError):
                validate_start(
                    {"type": "start", "durationSeconds": seconds, "evidence": EVIDENCE}
                )
        with self.assertRaises(ValueError):
            validate_start(
                {"type": "start", "durationSeconds": 60, "evidence": EVIDENCE * 30}
            )

    def test_retrieval_preserves_facts_and_cites_selected_ids(self):
        result = select_reference(
            EVIDENCE, "Human: How did you reduce checkout failures?"
        )
        self.assertIn("[one]", result)
        self.assertIn("30 percent", result)
        self.assertNotIn("\n", result)
        self.assertLessEqual(len(result), 1800)

    def test_transcript_speaker_comes_from_wire_role(self):
        self.assertEqual(
            decode_text(b"\x07\x0acandidate words"),
            {"type": "text", "speaker": "user", "text": "candidate words"},
        )
        self.assertEqual(decode_text(b"\x07\x04model words")["speaker"], "assistant")
        self.assertIsNone(decode_text(b"\x09\x04reference"))


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.received = []
        self.ready_delay = 0

        async def upstream(request):
            socket = web.WebSocketResponse()
            await socket.prepare(request)
            await asyncio.sleep(self.ready_delay)
            await socket.send_bytes(b"\x00")
            async for msg in socket:
                if msg.type == WSMsgType.BINARY:
                    self.received.append(msg.data)
                    await socket.send_bytes(msg.data)
                    await socket.send_bytes(b"\x07\x0a hello")
            return socket

        upstream_app = web.Application()
        upstream_app.router.add_get("/api/chat", upstream)
        self.upstream = TestServer(upstream_app)
        await self.upstream.start_server()
        self.app = create_app(
            str(self.upstream.make_url("/api/chat")).replace("http:", "ws:"),
            heartbeat_seconds=2,
        )
        self.server = TestServer(self.app)
        await self.server.start_server()
        self.client = ClientSession()
        self.sockets = []

    async def asyncTearDown(self):
        for socket in self.sockets:
            await socket.close()
        await self.client.close()
        await self.server.close()
        await self.upstream.close()

    async def start(self):
        ws = await self.client.ws_connect(self.server.make_url("/session"))
        self.sockets.append(ws)
        await ws.send_json(
            {"type": "start", "durationSeconds": 60, "evidence": EVIDENCE}
        )
        self.assertEqual((await ws.receive_json())["type"], "ready")
        return ws

    async def test_real_opus_roundtrip_and_role_attribution(self):
        ws = await self.start()
        await ws.send_bytes(struct.pack("<2400f", *([0.1] * 2400)))
        audio = await ws.receive(timeout=2)
        self.assertEqual(audio.type, WSMsgType.BINARY)
        self.assertGreater(len(audio.data), 0)
        self.assertEqual(self.received[0][0], 1)
        self.assertEqual((await ws.receive_json())["speaker"], "user")
        await ws.send_json({"type": "end"})
        self.assertEqual((await ws.receive_json())["reason"], "client-ended")
        audio_packets = [message for message in self.received if message[:1] == b"\x01"]
        self.assertEqual(len(audio_packets), 2)

    async def test_exclusive_session_and_evidence_erased_after_disconnect(self):
        ws = await self.start()
        second = await self.client.ws_connect(self.server.make_url("/session"))
        self.assertEqual((await second.receive_json())["type"], "error")
        await second.close()
        async with self.client.post(
            self.server.make_url("/v1/chat/completions"),
            json={"messages": [{"content": "checkout"}]},
        ) as response:
            self.assertIn(
                "30 percent",
                (await response.json())["choices"][0]["message"]["content"],
            )
        await ws.close()
        async with asyncio.timeout(1):
            while self.app[STATE]["active"]:
                await asyncio.sleep(0.005)
        async with self.client.post(
            self.server.make_url("/v1/chat/completions"), json={"messages": []}
        ) as response:
            self.assertNotIn("30 percent", json.dumps(await response.json()))

    async def test_missed_heartbeat_closes_session(self):
        self.app[STATE]["heartbeat_seconds"] = 0.15
        ws = await self.start()
        self.assertEqual(
            (await ws.receive_json(timeout=2))["reason"], "heartbeat-expired"
        )

    async def test_browser_origin_cannot_open_cloud_bridge(self):
        async with self.client.get(
            self.server.make_url("/session"),
            headers={"Origin": "https://untrusted.example"},
        ) as response:
            self.assertEqual(response.status, 403)

    async def test_end_cancels_model_warmup(self):
        self.ready_delay = 0.1
        ws = await self.client.ws_connect(self.server.make_url("/session"))
        self.sockets.append(ws)
        await ws.send_json(
            {"type": "start", "durationSeconds": 60, "evidence": EVIDENCE}
        )
        await ws.send_json({"type": "end"})
        self.assertEqual((await ws.receive_json(timeout=1))["reason"], "client-ended")
        self.assertEqual(self.app[STATE]["evidence"], [])

    async def test_missed_heartbeat_also_cancels_model_warmup(self):
        self.app[STATE]["heartbeat_seconds"] = 0.15
        self.ready_delay = 0.4
        ws = await self.client.ws_connect(self.server.make_url("/session"))
        self.sockets.append(ws)
        await ws.send_json(
            {"type": "start", "durationSeconds": 60, "evidence": EVIDENCE}
        )
        self.assertEqual(
            (await ws.receive_json(timeout=1))["reason"], "heartbeat-expired"
        )
        self.assertEqual(self.app[STATE]["evidence"], [])

    async def test_invalid_pcm_fails_closed(self):
        ws = await self.start()
        await ws.send_bytes(struct.pack("<f", float("nan")))
        self.assertEqual((await ws.receive_json())["type"], "error")
        self.assertEqual((await ws.receive_json())["reason"], "session-error")
        self.assertEqual(self.received, [])

    async def test_cloud_deadline_overrides_longer_requested_session(self):
        self.app[STATE]["heartbeat_seconds"] = 2
        self.app[STATE]["deadline"] = time.time() + 3.3
        ws = await self.start()
        self.assertEqual(
            (await ws.receive_json(timeout=2))["reason"], "deadline-expired"
        )

    async def test_expired_cloud_deadline_never_connects_model(self):
        self.app[STATE]["deadline"] = time.time() - 1
        ws = await self.client.ws_connect(self.server.make_url("/session"))
        self.sockets.append(ws)
        await ws.send_json(
            {"type": "start", "durationSeconds": 60, "evidence": EVIDENCE}
        )
        self.assertEqual((await ws.receive_json())["type"], "error")
        self.assertEqual(self.app[STATE]["evidence"], [])


if __name__ == "__main__":
    unittest.main()
