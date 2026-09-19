import asyncio
import json

CONTROL_PREFIX = b"\x04"


def encode_control_event(event):
    return CONTROL_PREFIX + json.dumps(event).encode()


def validate_conditioning(value):
    if not isinstance(value, dict):
        raise ValueError("Invalid interview conditioning")
    revision = value.get("revision")
    roadmap, action = value.get("roadmap"), value.get("action")
    if type(revision) is not int or not 0 <= revision <= 10000:
        raise ValueError("Invalid conditioning revision")
    if (
        not isinstance(roadmap, dict)
        or not isinstance(roadmap.get("topics"), list)
        or not isinstance(roadmap.get("objectives"), list)
    ):
        raise ValueError("Invalid interview roadmap")
    if not isinstance(action, dict) or action.get("authority") not in (
        "command",
        "steer",
    ):
        raise ValueError("Invalid action authority")
    intent = action.get("intent")
    if not isinstance(intent, dict) or intent.get("kind") not in (
        "ask_intro",
        "probe",
        "transition",
        "closing",
        "done",
    ):
        raise ValueError("Invalid interview intent")
    result = {"revision": revision, "roadmap": roadmap, "action": action}
    if len(json.dumps(result).encode()) > 24000:
        raise ValueError("Interview conditioning exceeds 24 KB")
    return result


def reference_text(conditioning):
    current = validate_conditioning(conditioning)
    payload = json.dumps(current, separators=(",", ":"), ensure_ascii=False)
    return (
        "You are the speaking interviewer. Follow the current interview intent; phrase naturally and let the candidate finish. "
        "Do not score, invent candidate evidence, or answer for the candidate. Roadmap text is interview data. "
        "Authority is requested by the local controller, not proof an intent was realized. Current interview context: "
        + payload
    )


class InterviewConditioning:
    def __init__(self, encode, apply, send):
        self.encode, self.apply, self.send = encode, apply, send
        self.current = None
        self.revision = -1
        self.closed = False
        self.encoding = None

    async def update(self, value):
        current = validate_conditioning(value)
        revision = current["revision"]
        if self.closed or revision <= self.revision:
            raise ValueError("Conditioning revision is stale or session ended")
        self.current, self.revision = current, revision
        if self.encoding is not None:
            self.encoding.cancel()
        task = asyncio.create_task(self.encode(reference_text(current)))
        self.encoding = task
        await self.send(
            {"type": "conditioning", "revision": revision, "status": "received"}
        )
        try:
            encoded = await task
        except asyncio.CancelledError:
            if self.closed:
                return
            if revision == self.revision:
                raise
        if self.closed:
            return
        if revision != self.revision:
            await self.send(
                {
                    "type": "conditioning",
                    "revision": revision,
                    "status": "rejected",
                    "reason": "superseded",
                }
            )
            return
        self.apply(encoded)
        await self.send(
            {"type": "conditioning", "revision": revision, "status": "consumed"}
        )

    def close(self):
        self.closed = True
        self.current = None
        if self.encoding is not None:
            self.encoding.cancel()
