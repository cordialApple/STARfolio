import asyncio
import json
import struct
import unittest

from aiohttp import ClientSession, WSMsgType, web
from aiohttp.test_utils import TestServer
from gateway import STATE, create_app
from test_interview_protocol import conditioning


class InterviewGatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.app = create_app(fixture=True)
        self.server = TestServer(self.app)
        await self.server.start_server()
        self.client = ClientSession()
        self.ws = await self.client.ws_connect(self.server.make_url("/session"))
        await self.ws.send_json(
            {
                "type": "start",
                "durationSeconds": 60,
                "evidence": [],
                "conditioning": conditioning(),
            }
        )

    async def asyncTearDown(self):
        await self.ws.close()
        await self.client.close()
        await self.server.close()

    async def test_latest_reducer_intent_is_reference_and_stale_updates_rejected(self):
        self.assertEqual((await self.ws.receive_json())["type"], "ready")
        await self.ws.receive_json()
        await self.ws.send_json(
            {"type": "conditioning", "context": conditioning(1, "closing")}
        )
        receipt = await self.ws.receive_json()
        self.assertEqual(
            receipt, {"type": "conditioning", "revision": 1, "status": "received"}
        )
        await self.ws.send_json({"type": "conditioning", "context": conditioning(0)})
        self.assertEqual((await self.ws.receive_json())["status"], "rejected")
        async with self.client.post(
            self.server.make_url("/v1/chat/completions"), json={"messages": []}
        ) as response:
            text = (await response.json())["choices"][0]["message"]["content"]
            self.assertIn("closing", text)
            self.assertIn("Ownership", text)
            self.assertNotIn("Selected evidence:", text)
        await self.ws.close()
        await asyncio.sleep(0.02)
        self.assertIsNone(self.app[STATE]["conditioning"])


class NativeInterviewGatewayTests(unittest.IsolatedAsyncioTestCase):
    async def test_initial_prime_precedes_ready_and_raw_segments_reach_desktop(self):
        seen = []
        traffic = []

        async def native(request):
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            await ws.send_bytes(b"\x00")
            await ws.send_bytes(
                b"\x04"
                + json.dumps({"type": "interview-capabilities", "version": 1}).encode()
            )
            async for message in ws:
                if message.type == WSMsgType.BINARY:
                    if message.data[:1] == b"\x01":
                        traffic.append("audio")
                        continue
                    payload = json.loads(message.data[1:])
                    if payload["type"] == "finish":
                        traffic.append("finish")
                        await ws.send_bytes(
                            b"\x04"
                            + json.dumps(
                                {
                                    "type": "segment",
                                    "speaker": "candidate",
                                    "text": "Final answer tail",
                                    "startMs": 1300,
                                    "endMs": 1400,
                                    "truncated": True,
                                }
                            ).encode()
                        )
                        await ws.send_bytes(
                            b"\x04"
                            + json.dumps({"type": "flushed", "complete": True}).encode()
                        )
                        continue
                    context = payload["context"]
                    seen.append(context)
                    for status in ("received", "consumed"):
                        await ws.send_bytes(
                            b"\x04"
                            + json.dumps(
                                {
                                    "type": "conditioning",
                                    "revision": context["revision"],
                                    "status": status,
                                }
                            ).encode()
                        )
                    if context["revision"] == 1:
                        await ws.send_bytes(
                            b"\x04"
                            + json.dumps(
                                {
                                    "type": "segment",
                                    "speaker": "candidate",
                                    "text": "I owned retries",
                                    "startMs": 300,
                                    "endMs": 900,
                                    "truncated": False,
                                }
                            ).encode()
                        )
                        await ws.send_bytes(
                            b"\x04" + json.dumps({"type": "gap", "atMs": 1200}).encode()
                        )
            return ws

        app = web.Application()
        app.router.add_get("/api/chat", native)
        async with (
            TestServer(app) as upstream,
            TestServer(
                create_app(str(upstream.make_url("/api/chat")).replace("http:", "ws:"))
            ) as gateway,
            ClientSession() as client,
            client.ws_connect(gateway.make_url("/session")) as ws,
        ):
            await ws.send_json(
                {
                    "type": "start",
                    "durationSeconds": 60,
                    "evidence": [],
                    "conditioning": conditioning(),
                }
            )
            self.assertEqual((await ws.receive_json())["status"], "received")
            self.assertEqual((await ws.receive_json())["status"], "consumed")
            self.assertEqual((await ws.receive_json())["type"], "ready")
            await ws.send_json(
                {"type": "conditioning", "context": conditioning(1, "closing")}
            )
            self.assertEqual((await ws.receive_json())["status"], "received")
            self.assertEqual((await ws.receive_json())["status"], "consumed")
            self.assertEqual((await ws.receive_json())["speaker"], "candidate")
            self.assertEqual((await ws.receive_json())["type"], "gap")
            await ws.send_bytes(struct.pack("<2400f", *([0.1] * 2400)))
            await ws.send_json({"type": "end"})
            final = await ws.receive_json()
            self.assertEqual(final["text"], "Final answer tail")
            self.assertTrue(final["truncated"])
            self.assertEqual((await ws.receive_json())["type"], "ended")
        self.assertEqual([value["revision"] for value in seen], [0, 1])
        self.assertEqual(traffic, ["audio", "audio", "finish"])


class AutomaticCloseTests(unittest.IsolatedAsyncioTestCase):
    async def test_deadline_and_heartbeat_flush_final_evidence(self):
        for ending in ("deadline", "heartbeat", "session-error"):
            with self.subTest(ending=ending):
                finished = []

                async def native(request):
                    ws = web.WebSocketResponse()
                    await ws.prepare(request)
                    await ws.send_bytes(b"\x00")
                    await ws.send_bytes(
                        b"\x04"
                        + json.dumps(
                            {"type": "interview-capabilities", "version": 1}
                        ).encode()
                    )
                    async for message in ws:
                        if message.type == WSMsgType.BINARY:
                            value = json.loads(message.data[1:])
                            if value["type"] == "conditioning":
                                for status in ("received", "consumed"):
                                    await ws.send_bytes(
                                        b"\x04"
                                        + json.dumps(
                                            {
                                                "type": "conditioning",
                                                "revision": 0,
                                                "status": status,
                                            }
                                        ).encode()
                                    )
                            elif value["type"] == "finish":
                                finished.append(True)
                                await ws.send_bytes(
                                    b"\x04"
                                    + json.dumps(
                                        {
                                            "type": "segment",
                                            "speaker": "candidate",
                                            "text": "Important final evidence",
                                            "startMs": 0,
                                            "endMs": 80,
                                            "truncated": True,
                                        }
                                    ).encode()
                                )
                                await ws.send_bytes(
                                    b"\x04"
                                    + json.dumps(
                                        {"type": "flushed", "complete": True}
                                    ).encode()
                                )
                    return ws

                app = web.Application()
                app.router.add_get("/api/chat", native)
                async with TestServer(app) as upstream:
                    gateway_app = create_app(
                        str(upstream.make_url("/api/chat")).replace("http:", "ws:"),
                        heartbeat_seconds=0.1 if ending == "heartbeat" else 30,
                    )
                    async with (
                        TestServer(gateway_app) as gateway,
                        ClientSession() as client,
                        client.ws_connect(gateway.make_url("/session")) as ws,
                    ):
                        await ws.send_json(
                            {
                                "type": "start",
                                "durationSeconds": 1,
                                "evidence": [],
                                "conditioning": conditioning(),
                            }
                        )
                        for _ in range(3):
                            await ws.receive_json()
                        if ending == "session-error":
                            await ws.send_bytes(struct.pack("<f", float("nan")))
                        event = await ws.receive_json(timeout=3)
                        self.assertEqual(event["type"], "segment")
                        self.assertEqual(event["text"], "Important final evidence")
                        if ending == "session-error":
                            self.assertEqual((await ws.receive_json())["type"], "error")
                        self.assertEqual(
                            (await ws.receive_json())["reason"],
                            ending
                            if ending == "session-error"
                            else ending + "-expired",
                        )
                self.assertEqual(finished, [True])


if __name__ == "__main__":
    unittest.main()
