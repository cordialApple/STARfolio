# STARfolio roadmap

This is the forward plan. The [build plan](build-plan.md) records stage status. [CONTEXT.md](../CONTEXT.md)
records the current handoff, open branches, and reconciliation state.

## Operating boundary

STARfolio remains a normal local desktop app. The local machine owns the database, retrieval, interview
plan, scoring, reducer state, reports, and audit history. No STARfolio account or managed backend is
required.

AWS has one job: provide temporary GPU compute for MoshiRAG so development and use do not depend on a
GPU-capable PC. The experimental mode sends only live session audio and selected interview context
through an SSM tunnel to a loopback gateway on the worker. The worker is pinned, deadline-bound, and
torn down after the session. Budget policy is an operator concern, not a development gate or roadmap
input.

## Current state

- Push-to-talk voice remains the local, zero-GPU baseline.
- Recorder streaming integrity landed in PR #313.
- The temporary MoshiRAG worker and lifecycle automation landed in PR #314.
- The default-off remote interview path landed in PR #315.
- Unit, integration, lifecycle, build, and packaged Electron tests gate these changes in CI.
- Live GPU behavior is still unverified. Issue #312 is the hardware gate.

## D1: validate the remote MoshiRAG path

The control plane exists. The next step is a real temporary GPU run, not more mocks.

- Start from the pinned worker image and model revisions.
- Run a full interview with real microphone input and returned audio.
- Measure startup, interruption, deadline, disconnect, and teardown behavior.
- Compare remote gap-scoring against the local turn-based scorer on the same answers.
- Publish the result, including a no-go result. Do not weaken the rubric to make duplex pass.

Done means the worker terminates cleanly on success, timeout, disconnect, and failure; the local report
remains auditable; and issue #312 has evidence for each path.

## D2: finish the voice architecture deliberately

Three modes remain distinct:

1. Local push-to-talk is the reliable floor.
2. The cascade keeps exact spoken text auditable and remains the assessment-oriented path.
3. Remote MoshiRAG is an optional realism mode with barge-in and overlap.

Stages 6c and 6d are not prerequisites for validating the remote 6e path. Their runtime compute target
is unresolved, and they do not inherit the Stage 6e worker by implication. Any resumed service needs an
explicit boundary and cannot assume the STARfolio machine has an accelerator.

## D3: establish assessment validity

Delivery quality is not scoring validity. Build a pinned fixture suite with expected score bands,
evidence anchors, and per-dimension regressions. Record the provider and model revision used for every
published comparison. The same suite decides whether remote gap-scoring preserves rigor.

Done means a scoring change that loses grounded evidence or shifts a fixed answer outside its accepted
band fails CI.

## D4: add the Scroll peer adapter

Implement Scroll contracts 1 and 7 behind an injectable adapter. Scroll remains the trust root for
room identity, roles, capability grants, and grader verdicts. STARfolio observes the shared document;
it does not invent a parallel protocol or provision Scroll concepts.

Done means STARfolio can join as a credentialed read-only peer, consume the canonical verdict shape,
and run unchanged when Scroll is absent.

## D5: reconcile PersonalServer

STARfolio's one-way config writer is built and tested. It maps the local storage choice into
PersonalServer's config without launching, querying, or owning PersonalServer. Remaining work belongs
at the cross-repository contract boundary: confirm the PersonalServer reader accepts the shipped shape,
then reconcile markdown-schema and refresh behavior.

## D6: keep CI proportional and useful

- Every behavior change gets focused unit tests first.
- Boundary changes get integration tests.
- Feature slices get intermittent end-to-end coverage during development.
- Merge gates run lint, typecheck, unit and integration tests, production packaging, and packaged-app
  Electron smoke tests.
- AWS worker changes also run source-contract, lifecycle, shell, and CloudFormation validation.
- Live GPU tests stay explicit and evidence-producing. They never silently skip and report green.
- Property tests use deterministic CI replay. Model-generated cases are authored offline and reviewed
  before they become merge gates.
- PR #317 serializes test files only under `CI=true` and scopes extra XLSX cold-start time to that test;
  local runner defaults and functional assertions stay unchanged.

## D7: finish distribution

Verify install, backup, and update on a fresh Windows machine. Add signing when ready, but do not let
price estimates decide development order. The release gate is operational evidence: install, onboard,
complete an interview, back up, and update successfully.

## D8: add the Anthropic SDK credential fallback

Keep a stored Console key as the primary Anthropic credential. When no key is stored, allow the SDK to
resolve supported local environment or profile credentials and show the active source in Settings.
This is a developer and key-management convenience, not a STARfolio account or credential proxy.

## Development flow

Raise the issue before implementation. Give each slice one human branch. Write tests, implement the
smallest complete behavior, simplify once, review through focused lenses, adjudicate findings, then
open a concise PR. Merge only after current-base CI is green. Squash with one Conventional Commit and
delete the branch.

The next merge-worthy slice is D1, issue #312. D2 through D8 can proceed independently when they do not
change the same boundary.
