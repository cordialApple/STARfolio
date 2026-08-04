# STARfolio — roadmap

Phased build order from here forward, derived from [starfolio-concept.md](starfolio-concept.md) and
[architecture.md](architecture.md). The [build plan](build-plan.md) is the *stage index* — what was
built and in what order. This is the *forward* document: what remains, why it is next, and the one
falsifiable sentence that closes each phase.

Stages 0–5, 7–10 are checkpoint-passed. The remaining program is four tracks that interleave rather
than queue: an integration seam that is pure-CPU and unblocked today (R1), a voice arc that is gated
on GPU hardware (R2–R4), an assessment-validity track that is the actual product claim (R5), and
distribution (R6). A cross-cutting quality track (Q) runs alongside all of them.

Two facts shape the ordering. First, **the voice arc is hardware-gated and the rest of the program is
not** — R1, R5, and R6 must never be scheduled behind a GPU. Second, **the cascade (R3) is the
flagship, not a stepping-stone to R4**; see
[architecture/full-duplex-migration.md](architecture/full-duplex-migration.md).

## R0 — Close the ledger (housekeeping, blocking nothing)

The status surface has drifted from the tree, and a roadmap written on top of a lying index inherits
the lie.

- `docs/build-plan.md` row 6d reads `☐` while `stage-06d` has 6d.2a–6d.2e all checked → `◐`.
- `docs/build-plan.md` row 11 reads `◐` with 11.1–11.4 all checked. That is **not** drift: Checkpoint 11
  is a manual fresh-machine install-and-update pass, and it has not been recorded as run. `◐` stands
  until it is — same rule the voice stages live under. R6 is what closes it.
- `stage-06b` shows 6b.1–6b.4 unchecked with only 6b.5 checked. 6b is **superseded by 6c** — those four
  boxes are not debt, they are an abandoned approach (energy-RMS VAD + sliding-window re-decode +
  LocalAgreement-2). Record the supersession explicitly rather than leaving boxes that will never be
  ticked; the 6b.5 streaming budget stays as the *whisper-era* budget the 6c budget supersedes.
- PR #299 (12.17 `recorder.ts` streaming-buffer ISP gate) is green and mergeable but **held for a user
  live-mic pass** — it is behavior-sensitive on the capture path. It is the one standing exception to
  auto-merge. Stage 12 stays `◐` until it lands.

Milestone: every status marker in `build-plan.md` is a true statement about `origin/main`, and every
unchecked box in `stages/` is either live work or an explicitly recorded supersession.

## R1 — Scroll-peer adapter (contracts 1 + 7) — the one open trio piece

The trio is Scroll (owner of every contract), PersonalServer (C#, Claude-only MCP), STARfolio
(consumer). The dependency arrow only ever points at Scroll. STARfolio's remaining obligation is
**contract 1 (peer protocol) + contract 7 (peer credentials)** — the "Scroll-peer adapter." It is
pure-CPU, needs no GPU and no model, is unblocked today, and is currently tracked in **no** SuperSTAR
document. That gap is the single largest specificity hole in the docs and R1 closes it.

- **Adapter seam first, transport second.** A `ScrollPeer` interface under `app/src/main/integration/`
  in the shape the rest of the main process already uses for injectable seams (Stage 12's pattern):
  connect / observe / disconnect, with an in-memory fake as the default test double. No Yjs types
  cross the seam into the interviewer engine.
- **Contract 1 — peer protocol, OCP + Adapter.** STARfolio implements Scroll's peer protocol; it does
  not define a variant of it. Scroll's invariant is that **at the room boundary the interviewer is
  indistinguishable from a human peer** — the adapter therefore joins, subscribes to awareness, and
  reads the shared document through exactly the same interfaces a browser peer uses. Read-only in the
  first cut: observation, not authorship.
- **Contract 7 — peer credentials, Scroll is the sole trust root.** The adapter accepts a room-scoped
  peer token carrying identity, a **Scroll-asserted** role (`human` | `agent`), capability grants, and
  an expiry. STARfolio never issues identity, never self-declares a role, never federates a token
  across rooms, and treats an expired or role-less token as a hard connect failure rather than
  degrading to an unauthenticated join.
- **Grader is a trust boundary, not a helper.** ide-es verdicts arrive as Scroll's `ResultPayload`
  (`{ endpointId, status, withinBudget, passed, total, at }`) through Scroll's single choke point.
  STARfolio consumes that shape verbatim, validates it, and never recomputes or second-guesses a
  verdict locally.
- **Degrade cleanly when Scroll is not running.** Same posture as PersonalServer's contract-6 seed: no
  Scroll → the interviewer runs exactly as it does today, no error surface beyond a settings-level
  "not connected" state. Scroll is additive; nothing in the core loop may become conditional on it.
- **Boundary self-check, copied from Scroll's.** The checkable violation in the other direction: if
  STARfolio's adapter ever asks Scroll to add a STARfolio concept, the arrow reversed. Open fork noted
  in Scroll's P4: native notepad/whiteboard surfaces vs STARfolio provisioning its own observability —
  R1 assumes the former and stays a reader until that fork resolves.
- **Docs owed alongside the code:** `docs/integrations/scroll.md` (consumer-side statement of what
  STARfolio implements and what it merely reads) and `docs/architecture/boundaries.md` (STARfolio's own
  arrow-direction rule). Both are named after Scroll's equivalents on purpose — parity of vocabulary is
  what makes a cross-repo review cheap.

Milestone: STARfolio joins a live Scroll room as a credentialed peer, the AI interviewer reads the
candidate's working document as it is being edited, and Scroll's own logs cannot distinguish that peer
from a human one — with the same build, disconnected from Scroll, still running a full interview.

## R2 — Streaming-STT swap (Stage A, `stage-06c`)

Replace the whisper-era streaming front end with Kyutai's delayed-streams STT. This is a **swap behind
an existing seam**, not a new capability: the renderer contract `voice:partial { text, stableUpTo }`
does not change, and `RollingTranscript` plus the tiered LLM brain consume it unchanged.

- **6c.1 spike is the gate.** Stand Kyutai STT up on the target GPU; the streaming adapter must emit
  committed word tokens plus semantic end-of-turn behind the existing partial event, with endpointing
  parity-or-better against the shipped energy-RMS VAD + 1.28 s hangover. Anything failing here reshapes
  the stage while it is cheap — the same discipline Stage 0 applied to the batch risks.
- **Model ladder.** `kyutai/stt-1b-en_fr` (~1 B params, **0.5 s** delay) is the default; `stt-2.6b-en`
  (~2.6 B, **2.5 s** delay) is the WER escape hatch, not the default — 2.5 s of added delay is a worse
  interview than a slightly worse transcript. Word-level timestamps come free and are what make the
  rest of the arc's latency ledger measurable. Batchability (hundreds of streams per H100 upstream) is
  irrelevant to a single-user desktop app and must not drive the choice.
- **`stableUpTo` is redefined, not removed.** From "the LocalAgreement-2-frozen prefix" to "all
  committed tokens." The renderer is untouched; the *meaning* behind the number improves. This is the
  clearest example in the codebase of a contract outliving its first implementation, and it should be
  documented as such.
- **Retire six whisper-era modules** on landing: `SampleRingBuffer` usage, `FrameSource`, `EnergyVad`,
  `StreamWindow`, the whisper batch stream-decoder, and LocalAgreement-2. **Stage 6's push-to-talk batch
  path is explicitly not part of the swap** — it stays as the zero-GPU fallback and as the mode that
  keeps the app usable on a machine with no accelerator at all.
- **Half-duplex stays.** Stage A is still half-duplex; the TTS→mic gate is not touched here.
- **6c.5 on-hardware sustained pass** — real mic, packaged build, no mid-thought cut-offs. Publish the
  new endpoint budget (~500 ms vs 1.28 s) as the document that supersedes the 6b.5 streaming budget.

Milestone: on the target GPU, end-of-speech to finalized turn measures ~500 ms in a packaged build over
a real microphone, the six whisper-era streaming modules are deleted, and no renderer or tier code
changed to make it happen.

## R3 — Cascade streaming TTS (Stage B, `stage-06d`) — the flagship

An Unmute-shaped cascade: streaming STT → tiered LLM → streaming TTS, with the tiers running verbatim.
6d.1 and 6d.2a–2e have landed (including the turn-loop orchestrator and its half-duplex gate); what
remains is scaffolding removal and the hardware pass.

- **Why this is the flagship.** The cascade keeps the interviewer's words *auditable*: the exact text
  the tiers produced is the exact text spoken. An entry-level assessment product whose scoring cannot
  be traced to a transcript is not an assessment product. R4 trades some of that away deliberately and
  only if it can prove it does not lose rigor.
- **Streaming in text, not just out in audio.** Kyutai TTS (~2 B params, **220 ms** latency, 2.5 M
  hours) accepts text as it is generated rather than requiring a finished turn — that property, not the
  raw latency number, is what removes the turn buffer. Reported headroom is 32 simultaneous streams
  under 350 ms end-to-end on one L40; a single-user app needs one.
- **6d.3 — retire the TTFT guard and the stall watchdog.** They papered over turn-buffered output.
  Genuinely streamed audio replaces them, and keeping them would mean keeping a monitor for a failure
  mode that no longer exists. Deleting them is the proof the streaming is real.
- **6d.4 — on-hardware sustained pass.** A full spoken interview, streaming both directions. Measure
  end-of-speech → first audio and publish it against the ledger: STT ~500 ms + tier round-trips + TTS
  start ~220 ms. That single number is the product's felt latency and should live in the docs as a
  tracked figure, not a claim.
- **The interrupt posture is a product decision, not a capability gap.** AI-interrupts-candidate is
  destructive for entry-level assessment: an entry-level candidate cut off mid-answer produces a worse
  sample and a worse experience, and the thing being measured is their answer, not their turn-taking
  reflexes. The cascade's turn gate is therefore a feature.

Milestone: a full spoken mock interview runs with audio streaming in both directions, the TTFT guard
and stall watchdog are deleted from the tree, and the measured end-of-speech → first-audio figure is
published in the voice docs.

## R4 — Native full-duplex (Stage C, `stage-06e`) — gated on a rigor measurement

Moshi/Mimi as a native full-duplex speech model, with the tiers demoted to an asynchronous gap-scoring
sidecar. **This stage may legitimately never happen**, and the roadmap says so up front.

- **6e.1 is the stage.** The go/no-go spike *is* the deliverable: measure whether asynchronous
  gap-scoring preserves coverage-dimension rubric rigor — Sonnet scoring over Moshi's Inner Monologue
  transcript, fired in conversational gaps, versus the turn-based tiers scoring the same answers.
  Rigor holds → proceed. It does not → the stage stops, and the fallback is either R3 as shipped or the
  **"C-lite"** avenue: a post-hoc Sonnet evaluation report with no live steering.
- **The one real leak, and its fix.** Under duplex the reducer contract forks. Draw the seam at
  **intents, not utterances**: above the line is shared (the Opus roadmap, a mouth-agnostic canonical
  transcript, Sonnet scoring, a reducer emitting an intent plus an authority level, the final report);
  below the line is per-mouth (turn detection, realization timing, phrasing, barge-in, transport).
  Steering, not scripting — the exact wording is Moshi's, not Haiku's.
- **MoshiRAG is the interesting variant, not the safe one** (arXiv:2604.12928; ICML 2026). It exploits
  the **keyword delay** — the gap between response onset and the delivery of the informationally
  load-bearing words — to fire asynchronous retrieval without disrupting real-time flow, front-end
  (full-duplex Moshi) decoupled from back-end (async retrieval), plug-and-play without retraining.
  Mapped onto STARfolio that gap is exactly where a retrieval against the candidate's own experience
  bank would go. Attractive; strictly downstream of 6e.1 passing.
- **6e.2–6e.5** — Moshi/Mimi behind the existing `app/src/main/voice/` seam; the evaluator-sidecar
  bridge; steering injection as conditioning; barge-in/overlap surface plus the sustained hardware pass.
- **Non-negotiable across the whole stage:** the evaluation report still shows auditable per-dimension
  scores. If duplex costs the audit trail, duplex loses.

Milestone: the 6e.1 measurement is published with a verdict either way — and if it passes, a live
duplex interview produces a per-dimension evaluation report indistinguishable in rigor from the
cascade's on the same answers.

## R5 — Assessment validity (the actual product claim)

Everything above is delivery machinery. This is the track that decides whether the output is worth
anything, and it is the least documented part of the repo relative to its importance.

- **The literature sets the bar, and it is a bar STARfolio can clear.** Structured behavioral
  interviews measure ≈ **.51** predictive validity against ≈ **.38** for unstructured; the composite
  with cognitive-ability assessment reaches ≈ **.63**. More structure monotonically improves validity,
  rater reliability, and rater agreement, and reduces adverse impact. A deterministic reducer driving a
  fixed coverage-dimension rubric is *structurally* the high-validity condition — that is the claim to
  make explicit and then defend.
- **Behaviorally-anchored rating scales.** BARS outperform unstructured rating. The scoring rubric
  needs per-level performance exemplars, a consistent scale across dimensions, and explicit room to
  capture the supporting evidence for each score. The evidence field is not decoration: it is what makes
  a score reviewable, and it is what R4 is forbidden to lose.
- **Entry-level is the whole product** (no level picker, no level labels, no level-mix in dashboards).
  The published literature on entry-level-specific structured interviewing is thin outside medical and
  graduate-entry MMI contexts — so the rubric's entry-level calibration is STARfolio's own claim and
  must be defended by its own artifacts (fixed transcripts, expected score bands, pinned by tests)
  rather than by citation.
- **Scorer rigor is a regression surface, not a vibe.** The 6d.2d work already proved the scorer holds
  rigor on duplex-shaped transcripts; generalize that into a standing scorer-rigor fixture suite that
  every scoring change must clear. This is what makes 6e.1's measurement meaningful — without a
  baseline, "rigor holds" is unfalsifiable.
- **Model routing is a slot, not a hardcode** (landed): per-role provider routing across
  anthropic | openai | gemini. Validity work must therefore state which role/model combination a
  published rigor number was measured against, or the number is not reproducible.

Milestone: a published scoring-validity note that states STARfolio's structured-interview claim, and a
fixture suite where any change to a scoring path that degrades per-dimension rigor turns CI red.

## Q — Quality track (cross-cutting, not a phase)

Runs alongside the R-line. Small and always-on inside the existing CI job — no nightly farm.

- **Q1 — property-based testing in CI** (`fast-check`), per [plans/pbt-in-ci.md](plans/pbt-in-ci.md).
  PR = fixed-seed short campaign; main push = heavier run-number-seeded campaign. A failure dumps a
  value-based `{initial, ops, expected, observed}` artifact that is promoted to a committed,
  seed-independent regression fixture and replayed forever after. STARfolio's analogue of Scroll's
  anchoring spine is the **retrieval + reducer** pair: hybrid FTS5/vector retrieval must not lose a
  grounded source under any ingestion order, and the reducer must be a pure function of the scored
  transcript.
- **Q2 — AI-generated properties are first-class but authoring-time only.** A model reads failure
  artifacts, diffs, and generators offline and proposes new adversarial dimensions as committed
  deterministic artifacts. CI replays them and never calls a model. Every AI artifact lands
  `@exploratory` and is adjudicator-gated — an AI oracle never silently becomes source of truth.
- **Q3 — naming and comment hygiene as a standing rule, not a one-off sweep.** Verb-first camelCase,
  `is`/`has`/`can`/`should` predicates, `create`/`make` factories, `to`/`from`/`parse`/`format`/
  `normalize` converters, `handle<Event>` / `on<Event>`, `PascalCase` components and `use<X>` hooks, no
  `I` prefix, no negated booleans, repo-established abbreviations only. Comments carry a non-obvious
  **why** or they do not exist. Names never cross a wire boundary: IPC channels, DB columns, SQL text,
  JSON keys, preference keys, and asserted error strings are values, not identifiers.
- **Q4 — the gate itself.** simplifier → parallel single-lens `inspector`s → `adjudicator` (which
  sabotage-verifies the tests have teeth) → fix → commit → re-adjudicate → PR → CI green → merge →
  cleanup. Green-but-stale is a real failure mode — a PR that passed against an older base can turn
  `main` red on merge, so the adjudicator gate checks freshness against the base, not just the diff.
- **Q5 — hardware-gated tests are marked, never silently skipped.** The voice arc's real budgets are
  only measurable on the target GPU. A budget assertion that quietly no-ops on a machine without an
  accelerator is worse than no assertion.

Milestone: a generated adversarial ingestion/retrieval schedule that loses a grounded source, or a
reducer input that produces a non-deterministic intent, is a minimized, seed-independent, replayable
committed fixture.

## R6 — Distribution and v1.0

The app installs, updates, and backs up cleanly today (Stage 11). What remains is the trust surface.

- **Code signing is the last real user-facing defect.** Unsigned Windows installers hit SmartScreen,
  and for a product whose entire pitch is "your career history stays on your machine," a scary install
  warning is a credibility problem, not a cosmetic one.
- **Azure Artifact Signing** (renamed from Azure Trusted Signing) is the intended route: cheapest
  option, clears SmartScreen, and since October 2025 open to **individual developers in the US and
  Canada** — which is what makes it viable for a single-developer project at all. OV certificates are
  under €100/yr but must *earn* SmartScreen reputation from a cold start; EV certificates are
  hardware-token-bound and non-exportable but carry reputation immediately. Note the schedule change:
  **from March 2026, Windows OV code-signing certificates are capped at 460 days (~15 months)**, so the
  renewal cadence is now part of the release process rather than an afterthought.
- **Verify the signed update path end-to-end on a fresh machine**, not just the installer. Stage 11's
  checkpoint accepted an unsigned path with manual-download fallback; v1.0 closes that.
- **v1.0 gate:** fresh Windows machine → signed install with no SmartScreen warning → onboard → full
  interview → backup → signed auto-update to the next build.

Milestone: a fresh, never-seen-this-app Windows machine installs a signed build with no SmartScreen
interstitial and auto-updates to the following signed release without user intervention.

## Scoping reminder

- **R1 needs no GPU, no model, and nothing from Scroll beyond contracts already written.** It is the
  only remaining trio obligation and the only phase here that another repo is waiting on. It should not
  queue behind the voice arc.
- **R2 → R3 is a hard sequence** (the cascade needs the streaming front end). **R3 → R4 is not** — R4 is
  conditional on a measurement, and R3 is a legitimate terminal state for the voice arc.
- **R5 gates R4, not the reverse.** Without a scorer-rigor baseline the 6e.1 verdict cannot be computed,
  so the fixture suite is a prerequisite to even attempting Stage C.
- **R6 is independent of everything above** and can land at any point once Stage 12 closes; it is
  sequenced last only because signing has an ongoing cost.
- Stage 6's push-to-talk batch path is permanent, not legacy. It is the zero-GPU floor that keeps the
  app usable on hardware none of R2–R4 will ever run on.
