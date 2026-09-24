# First MoshiRAG demo

Opus roadmap → Moshi speech surface → canonical candidate/interviewer transcript → local asynchronous Sonnet scoring → deterministic reducer → revised Moshi conditioning. AWS supplies GPU speech compute. Architect, scorer, reducer, credentials, and report stay in desktop process.

`interview_worker.py` wraps pinned native Channel. Initial intent reaches ARC before desktop ready; later revisions encode asynchronously while audio continues. Older encoder results cannot overwrite newer intent. Native unversioned ARC updates are disabled; `/v1/chat/completions` supplies latest roadmap/intent context to MoshiRAG retrieval requests. Bank keyword retrieval remains compatibility code for old fixtures; corrected interview path requires roadmap conditioning.

Receipts mean controller context received or ARC tensor applied. Neither proves spoken intent realization. Commands remain auditable obligations; GPU rubric parity and command adherence need live measurement.

## Local validation, no GPU or microphone

```powershell
py -3.12 -m venv .venv-demo
.venv-demo/Scripts/python -m pip install -r demo/moshi-gateway/requirements.txt
.venv-demo/Scripts/python -m unittest discover -s demo/moshi-gateway -v
.venv-demo/Scripts/python demo/moshi-gateway/gateway.py --fixture
```

Fixture serves readiness, fixed labeled text, current interview context, and session controls. It never reports ARC consumption. It does not simulate model quality. Tests separately exercise real Opus conversion through a local WebSocket echo server. App starts capture only after explicit Start and consent; tests use generated PCM.

## AWS worker

Use `infra/aws-demo/demo.py` lifecycle commands. The bundle includes this directory. Bootstrap expects an Ubuntu CUDA image with Python 3.12, an NVIDIA driver, root privileges, internet egress, an absolute deadline, and a relative maximum runtime. It installs a dedicated service account, pinned Moshi source `8c6dfc101b7871baa428424bcdc583b74fb561d9`, gateway dependencies, model server, reference encoder, and ASR. Model downloads occur at startup; readiness can take several minutes. GPU fit and latency require the first live AWS validation.

All services bind loopback. SSM forwards local port 8765 to worker port 8765. Gateway rejects browser Origin headers. Only one session accepted; evidence stays in worker memory and clears on disconnect. App heartbeat loss closes session within 30 seconds; duration cannot exceed 30 minutes. End, disconnect, or process failure stops model processes and invokes host shutdown; the instance is configured to terminate on OS shutdown. Host timer and independent AWS deadline provide additional shutdown. Ending app session does **not** confirm EC2 termination: verify using lifecycle `status`; use `stop` if necessary, then `delete` to remove stack resources. Root disk configured for deletion at termination.

Upstream INFO logs include transcript/reference content, so worker suppresses INFO and stdout; no raw audio recorded on the worker. A bounded bootstrap/service diagnostic tail is uploaded to the private trial S3 key before shutdown. Warnings and errors may still contain sensitive content; do not publish that object. EC2 disk, boot logs, and the existing artifact bucket remain subject to lifecycle cleanup.

## Protocol

- `ws://127.0.0.1:8765/session`: JSON `start` with `durationSeconds`, `evidence` (may be empty), and `conditioning: {revision, roadmap, action: {intent, authority}}`.
- Initial native `ready` follows protocol capability check and initial ARC consumption. Binary Float32 little-endian mono 24 kHz both directions.
- Client `conditioning` carries updated `context` in same shape. Revisions increase; context capped at 24 KB. Native receipts: `conditioning` with `revision`, `status: received|consumed|rejected`.
- Server `segment`: `speaker: candidate|interviewer`, `text`, `startMs`, `endMs`, `truncated`. Candidate text comes directly from local ASR before display buffering; interviewer text comes from model output tokens. Each speaker accumulates up to 2000 characters. SentencePiece spaces remain intact.
- Times use native input-ASR playhead and model output frame clocks. Ranges describe token-frame intervals, **not forced word alignment or measured acoustic boundaries**. Overlapping speaker ranges remain overlapping. Candidate onset marks an in-progress interviewer tail potentially truncated; final pending segments are conservatively marked truncated on End.
- Semantic VAD silence, followed by STT settling, flushes both speakers before `gap: {atMs}`. Resumed candidate speech cancels pending gap. Desktop scorer runs independently; no scoring keys leave desktop.
- Client `ping`, server `pong`; manual End, deadline, heartbeat, and recoverable session errors drain native queues and final segments before `ended`. Local ASR receives its model-delay length plus two silent frames, without extending Moshi speech; unsupported ASR drain reports incomplete. Drain bounded at worker two seconds, gateway three, desktop five. Incomplete drain or timeout appears in ended reason. Session duration starts at ready, matching desktop; cloud deadline reserves three seconds for drain. Disconnect clears conditioning and cancels encoding.
- `GET /health`: `mode`, `interviewProtocol: 1`, `upstreamReady`, `busy`, and optional `trialId`. Desktop rejects older generic gateway before architect work. Ready HTTP model server still needs per-session ASR initialization.
- `POST /v1/chat/completions`: local OpenAI-shaped reference endpoint; latest roadmap and reducer intent. No external retrieval credentials.

Native wire reference: [Kyutai channel.py](https://github.com/kyutai-labs/moshi-rag/blob/8c6dfc101b7871baa428424bcdc583b74fb561d9/moshi/moshi/inference_utils/channel.py). Software upstream MIT; model weights CC-BY 4.0 per [MoshiRAG README](https://github.com/kyutai-labs/moshi-rag/tree/8c6dfc101b7871baa428424bcdc583b74fb561d9).
