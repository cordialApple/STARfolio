import asyncio
import unittest

from interview_protocol import InterviewConditioning, validate_conditioning


def conditioning(revision=0, kind="ask_intro"):
    return {
        "revision": revision,
        "roadmap": {
            "topics": [{"id": "checkout", "label": "Checkout", "coverage": {}}],
            "objectives": ["Ownership"],
        },
        "action": {"authority": "command", "intent": {"kind": kind}},
    }


class ConditioningTests(unittest.IsolatedAsyncioTestCase):
    async def test_initial_context_is_applied_and_receipts_are_delivery_only(self):
        events, applied = [], []

        async def encode(text):
            return text

        async def send(event):
            events.append(event)

        bridge = InterviewConditioning(encode, applied.append, send)
        await bridge.update(conditioning())
        self.assertIn("ask_intro", applied[0])
        self.assertIn("Ownership", applied[0])
        self.assertEqual(
            [event["status"] for event in events], ["received", "consumed"]
        )
        self.assertFalse(any("realized" in event for event in events))

    async def test_late_encoding_cannot_overwrite_newer_intent(self):
        gates = {0: asyncio.Event(), 1: asyncio.Event()}
        events, applied = [], []

        async def encode(text):
            await gates[0 if '"revision":0' in text else 1].wait()
            return text

        async def send(event):
            events.append(event)

        bridge = InterviewConditioning(encode, applied.append, send)
        old = asyncio.create_task(bridge.update(conditioning(0)))
        await asyncio.sleep(0)
        new = asyncio.create_task(bridge.update(conditioning(1, "closing")))
        await asyncio.sleep(0)
        gates[1].set()
        await new
        gates[0].set()
        await old
        self.assertEqual(len(applied), 1)
        self.assertIn("closing", applied[0])
        self.assertIn(
            {
                "type": "conditioning",
                "revision": 0,
                "status": "rejected",
                "reason": "superseded",
            },
            events,
        )
        with self.assertRaises(ValueError):
            await bridge.update(conditioning(0))

    async def test_close_discards_encoding_and_context(self):
        gate = asyncio.Event()
        applied = []

        async def encode(text):
            await gate.wait()
            return text

        async def send(event):
            pass

        bridge = InterviewConditioning(encode, applied.append, send)
        task = asyncio.create_task(bridge.update(conditioning()))
        await asyncio.sleep(0)
        bridge.close()
        gate.set()
        await task
        self.assertEqual(applied, [])
        self.assertIsNone(bridge.current)
        with self.assertRaises(ValueError):
            await bridge.update(conditioning(1))

    async def test_context_rejects_unknown_authority_revision_and_oversize(self):
        for revision in [-1, True, 1.5]:
            with self.assertRaises(ValueError):
                validate_conditioning(conditioning(revision))
        bad = conditioning()
        bad["action"]["authority"] = "realized"
        with self.assertRaises(ValueError):
            validate_conditioning(bad)
        bad = conditioning()
        bad["roadmap"]["objectives"] = ["x" * 40000]
        with self.assertRaises(ValueError):
            validate_conditioning(bad)


if __name__ == "__main__":
    unittest.main()
