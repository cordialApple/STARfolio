# Property-based testing in CI

Staged plan for bringing property-based testing (PBT) into SuperSTAR's normal CI, modeled on
Scroll's `docs/plans/pbt-in-ci.md`. The hard bugs in this codebase are **state-evolution bugs in
the streaming-voice pipeline** — a committed transcript prefix that silently rewrites itself, an
end-of-turn that fires twice or never, a resampler that drifts a sample count, a msgpack frame that
does not round-trip — not pure-function arithmetic bugs. And the streaming-STT product promise
(**stable text is never rewritten; end-of-turn is deterministic; downstream sees a monotone
transcript**) is itself a property, not a test case. Design constraints, kept from the Scroll model:

- **Always-on inside normal CI.** No nightly fuzzing farm. Value is state-space coverage, not volume.
- **Deterministic seeds, always replayable.** A failure becomes a committed regression fixture, not
  a shrug.
- **Small budget.** Per-PR campaign in seconds; main/stage-push campaign in low minutes.
- **Semantic oracle, never audio.** The invariant is "the committed transcript the user already saw
  is still there, unchanged" and "the turn ended exactly when the endpointer says it did" — asserted
  against the pure model, never against WER, waveforms, or a live server.

## 0. Thesis — the streaming-STT promise is a monotonicity property

SuperSTAR's voice value proposition is a **streaming** one, and it is **embedded in the shipped
reducers**, not merely asserted by tests. The promise the whole voice pivot rests on — "text that
has been marked stable (`stableUpTo`) is final and will never be rewritten, the turn ends when the
endpointer says it does, and the interviewer downstream always reads a transcript that only grows" —
is a statement about *a stable prefix that is monotone under any order of arriving evidence*. That is
prefix-monotonicity + endpoint-determinism + idempotence-under-duplication: a
streaming-consistency property, not a UI detail. See
[`docs/architecture/voice.md`](../architecture/voice.md) and
[`docs/architecture/full-duplex-migration.md`](../architecture/full-duplex-migration.md).

So this plan is organized with **streaming-transcript invariants as the spine** (§5A), not a late
add-on. The single-stage reducer properties (§3) are the *local projection* of those invariants —
the smallest thing to land first — but the center of gravity is: the shipped mapping reducer +
`LocalAgreement` + `RollingTranscript`, driven by a fast-check-generated **transport adversary**
(reorder within allowed bounds / duplicate / drop / late-arrival / reconnect-resume), asserting the
**stable-prefix-never-rewrites** invariant. The invariants are enforced by **shipped modules** the
PBT exercises directly — `LocalAgreement` (`src/main/voice/streaming/local-agreement.ts`), the
rolling transcript (`src/main/voice/streaming/rolling-transcript.ts`), and the Kyutai mapping reducer
(`src/main/voice/kyutai/mapping.ts`, built in the Stage 6c spike). PBT proves those modules *are* the
stabilization mechanism; it does not bolt correctness on from outside.

The honesty line that makes this credible on the target hardware is drawn up front (full boundary in
§7 R3): the harness proves the **schema + stabilization + endpoint logic** converge under any message
schedule the wire could emit. It does **not** run the real `moshi-server`, measure WER, or prove GPU
latency — that is the on-hardware proof (Stage 6c.5), which is **deferred by hardware**: the dev box
is an Intel Core Ultra 7 258V (Lunar Lake, integrated Arc 140V, **no CUDA**), so real-weights STT
cannot run locally. That is precisely why the pure-core + fake-transport PBT is not a nice-to-have
here — it is the *only* way to validate the streaming logic on this machine. fast-check on the pure
reducers runs ~10³–10⁴ cases/sec across the 8 logical cores; a full campaign is seconds.

## 1. What already exists (the implicit invariants)

The repo already states its invariants — as examples. PBT generalizes them; almost no new concepts
are needed.

| Existing example-based test / contract | Implicit invariant to generalize |
|---|---|
| `rolling-transcript.test.ts` "ignores empty/whitespace finals, trims on commit, accumulates finals joined by space, appends live partial after committed finals" — a handful of fixed event lists | **For any sequence of `TranscriptEvent`s, the committed segment list only grows, each committed segment is trimmed and non-empty, and the live partial is exactly the last non-final text — never a stale one** |
| `local-agreement.ts` LocalAgreement-2 contract (comment lines 18–20: "the committed prefix never shrinks") | For **any** stream of hypotheses, `update` returns a `PartialTranscript` whose `stableUpTo` is non-decreasing, whose committed prefix is a prefix of every later committed prefix, and `finalize` produces `stableUpTo === text.length` |
| `types.ts` `TranscriptEvent { text, stableUpTo, isFinal }` — `stableUpTo` is a **character offset** into `text` | For every emitted event, `0 ≤ stableUpTo ≤ text.length`, and within a turn `stableUpTo` and `text.length` are both non-decreasing until `isFinal` resets the turn |
| `ring-buffer.ts` overflow-drop accounting (`PushResult { dropped, overflow }`, `droppedTotal`) | For **any** push sequence, `drain()` returns the most-recent `min(pushed, capacity)` samples **in order**, `dropped` exactly accounts for everything evicted, and `length ≤ capacity` always |
| `window.ts` `shouldDecode`/`maxWindowSamples` trim | `window()` is the in-order concatenation of appended frames minus the trimmed prefix; `total ≤ maxWindowSamples + oneFrame`; `shouldDecode` iff `sinceDecode ≥ interval ∧ total > 0` |
| `vad.ts` `EnergyVad` state machine (`minSpeechFrames`, `hangoverFrames`) | For **any** RMS sequence, `utteranceStart`/`utteranceEnd` strictly alternate, never fire twice, and `inUtterance` is exactly the parity of emitted events |
| Kyutai wire contract (Stage 6c research): committed Word tokens are final; `Step.prs[2] > 0.5` = end-of-turn; 24 kHz, 1920 samples/80 ms | Round-trip + reducer laws (§5A): `decode(encode(m)) ≡ m` for all protocol messages; resample 16k→24k conserves ≈1.5× samples bounded by input min/max; every committed Word advances `stableUpTo` to `text.length` and never retreats |

The pure substrate for all of this already exists and is server-free:

- `src/main/voice/streaming/local-agreement.ts` — `LocalAgreement` (pure, synchronous).
- `src/main/voice/streaming/rolling-transcript.ts` — `RollingTranscript` (pure, `now` injected).
- `src/main/voice/streaming/ring-buffer.ts` — `SampleRingBuffer` (pure).
- `src/main/voice/streaming/window.ts` — `StreamWindow` (pure).
- `src/main/voice/streaming/vad.ts` — `EnergyVad`, `frameRms` (pure).
- `src/main/voice/streaming/stream-decoder.ts` — `StreamDecoder`, orchestration with an **injected**
  `DecodeFn` and an explicit `drain()` — fake-able without any server (see §7 R1 for the async note).

One gap, filled by the Stage 6c spike: the Kyutai core (`protocol.ts` types, `codec.ts` msgpack,
`resample.ts` resampler+rechunk, `mapping.ts` OutMsg→`TranscriptEvent` reducer, `transport.ts`
interface + fake) does not exist yet. It is built with a fake transport from day one specifically so
these properties can exercise the *shipped* reducer, not a copy — the same discipline Scroll used to
extract `resolveEffectiveAnchor`.

## 2. Library choice and integration

**fast-check** (plain, not `@fast-check/vitest`). Reasons:

- De facto standard TS PBT library; integrated shrinking; replay via `{ seed, path }`; `fc.commands`
  for model-based testing later; zero transitive baggage.
- Plain `fc.assert(...)` inside ordinary vitest `it()` blocks means **zero runner changes**: the
  `test:unit` script (`node scripts/test-unit.mjs` → `vitest run`) already loads `*.test.ts` under the
  Node/Electron ABI probe, and the CI `Unit tests` step stays untouched. PBT files are just more
  `src/main/voice/**/*.test.ts` files in the default `node` environment (nothing here touches the DOM
  or better-sqlite3, so they run under plain Node without the ABI dance).
- `@fast-check/vitest` adds a wrapper for little gain; a ~30-line local helper gives us the
  seed/env/artifact behavior we actually want (§4).

Install: `npm i -D fast-check` (pin exact — see §7 R2). That is the entire new infrastructure.

New files (Stage 1):

```
src/main/voice/pbt/pbt.ts                     seed/runs config + failure-artifact wrapper + purity guard
src/main/voice/pbt/events.ts                  TranscriptEvent/hypothesis arbitraries + reducer drivers
src/main/voice/pbt/transcript.pbt.test.ts     first property family
src/main/voice/pbt/regressions/               committed failure fixtures (JSON), replayed every run
src/main/voice/pbt/coverage-ledger.json       committed per-property cumulative coverage (see §7 R4)
```

## 3. Stage 1 — the first property: stable-prefix monotonicity, in-memory, no server

PR-sized, adjudicator-gated, implementable immediately against code that already exists (no Kyutai
core needed for Stage 1 — it runs on `LocalAgreement` + `RollingTranscript`).

### 3.1 The input language (generator)

Inputs are **data first, interpreted second** — this is what makes shrinking and replay artifacts
work (a shrunk counterexample is a smaller event list, and the JSON artifact is that list). Two
generators, one per system under test:

```ts
// drives LocalAgreement.update / .finalize
type Hyp = { kind: 'update'; text: string } | { kind: 'finalize'; text?: string }

// drives RollingTranscript.push(event, at)
type Ev = { text: string; stableUpTo: number; isFinal: boolean; at: number }
```

- Hypothesis text is generated from a small seeded word pool with **growing-prefix bias**: each new
  hypothesis is the previous one with a random suffix edit (append / replace-tail / rarely
  truncate-tail), so the generator spends its budget on the realistic case — a whisper/Kyutai window
  that mostly extends and occasionally corrects its tail — instead of uniformly random strings.
- `Ev.stableUpTo` is generated as an offset **clamped into `[0, text.length]`** and `at` is a
  monotone-ish integer clock (occasional out-of-order to probe `recent()`), so every generated event
  is well-formed by construction and shrinks stay meaningful.
- The interpreter feeds the list to a fresh `new LocalAgreement()` / `new RollingTranscript()` — the
  shipped classes, not a reimplementation.

### 3.2 The oracle: "what stable text has the user already been shown"

Captured **incrementally**, as a running record of every committed prefix ever emitted:

```ts
interface StablePrefixLog { prefixes: string[] } // committed text after each step, in order
```

The oracle is not a snapshot — it is the whole history, because the invariant is about the
*relationship between successive states*, not any single state.

### 3.3 The assertions

Property A — **stable prefix never rewrites** (the streaming promise, generalized):

- feed the hypothesis list to `LocalAgreement`; after each `update`, record `committed = text.slice(0,
  stableUpTo)`
- assert for all `i < j`: `committed[i]` is a prefix of `committed[j]` (monotone growth, never a
  rewrite), and `stableUpTo` is non-decreasing
- assert `finalize()` yields `stableUpTo === text.length` and a committed string that has every prior
  committed prefix as a prefix

Property B — **`stableUpTo` is always a valid, in-bounds character offset**: for every emitted
`PartialTranscript`/`TranscriptEvent`, `0 ≤ stableUpTo ≤ text.length` and `text.slice(0, stableUpTo)`
is a whole-token prefix (no mid-token cut) — pins the `types.ts` contract that downstream relies on to
freeze stable text.

Property C — **rolling transcript accumulates, never loses a committed segment** (generalizes
`rolling-transcript.test.ts`): after any event list, `segmentCount` equals the number of non-empty
finals seen; `full().text` contains every committed segment in order; `livePartial` is exactly the
last non-final trimmed text or empty; a final with empty/whitespace text adds no segment. And
`recent(windowMs, now)` ⊆ `full()` for every window — a strict suffix-by-time, never inventing text.

Property D — **turn endpointing is a clean alternation** (`EnergyVad`): for any RMS-frame sequence,
the emitted `utteranceStart`/`utteranceEnd` events strictly alternate starting with `start`, and
`inUtterance` after the run equals `starts − ends ∈ {0,1}`. Absorbs the endpointing-parity intent of
the Stage 6c.1 spike gate at the unit level.

Property A is the single most valuable one if the stage must shrink further; A+B+C together are the
honest generalization of the existing voice tests and still one small PR.

### 3.4 Stage 1 exit criteria

- `npm run test:unit` green locally with default budget (≤ ~10s added).
- Properties fail loudly when sabotaged (verify during development by e.g. letting the committed
  prefix shrink in `LocalAgreement` — a manual mutation-test smoke check, not in CI).
- No changes to `ci.yml` yet — the tests already run inside the existing `Unit tests` step. (Per the
  build-loop rule, any later CI edit is adjudicator-gated.)

## 4. Seed determinism and failure-replay artifacts

### 4.1 Determinism contract

- `src/main/voice/pbt/pbt.ts` reads `PBT_SEED` (default: a fixed committed constant, e.g. `202607`)
  and `PBT_RUNS` (default 100 locally) and applies them via each `fc.assert` call's `{ seed, numRuns
  }`. Same seed ⇒ same generated cases ⇒ PR runs are byte-deterministic.
- Favorable starting point vs Scroll: the streaming reducers are **already** `Date.now`/`Math.random`
  free — `RollingTranscript` takes `now` as a parameter, `LocalAgreement`/`EnergyVad`/`StreamWindow`/
  `SampleRingBuffer` are pure. No production change is needed for determinism; the purity guard (§7
  R1) exists to keep it that way, not to retrofit it.
- No `Date.now`/`performance.now` in any property or interpreter. Stage 1 targets the **synchronous**
  reducers only. The one async component, `StreamDecoder`, is property-tested in Stage 4 by driving it
  with a synchronous fake `DecodeFn` and awaiting its explicit `drain()` — never a wall-clock timer.

### 4.2 Failure artifact

The `pbt.ts` wrapper around `fc.assert`, on failure, writes
`test-results/pbt/<property-name>.failure.json`:

```json
{
  "property": "stable-prefix-never-rewrites",
  "seed": 202607,
  "path": "12:3:1",
  "numRuns": 100,
  "counterexample": {
    "hypotheses": [
      { "kind": "update", "text": "tell me about a time" },
      { "kind": "update", "text": "tell me about a" },
      { "kind": "finalize" }
    ]
  },
  "observed": { "committedAtStep": ["tell me about a time", "tell me about a"], "violation": "prefix shrank at step 1" }
}
```

then rethrows, so vitest fails normally and fast-check's own seed/path line is in the log.

CI surfacing: add one step to the existing job in `.github/workflows/ci.yml`:

```yaml
- name: Upload PBT failure artifacts
  uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: pbt-failures
    path: app/test-results/pbt/
    retention-days: 7
```

### 4.3 Failure → committed regression fixture

- Local replay: `PBT_SEED=<seed> npm run test:unit -- transcript` reproduces exactly; fast-check
  shrinks to the minimal event list automatically.
- To pin it forever: drop the shrunk `counterexample` into `src/main/voice/pbt/regressions/`. A loader
  in `transcript.pbt.test.ts` globs that directory and replays every fixture **as an explicit example,
  not by seed** (§7 R2) — so regressions run on every PR at zero seed-budget cost and survive
  fast-check upgrades.
- This is the "random discovery → deterministic debugging → permanent bug report" loop, with the
  fixture living in-repo under normal review.

## 5. Property families → stages

Two-part structure. **§5A is the spine: streaming-transcript invariants under an adversarial
transport** — the voice value prop, tested against the shipped stabilization modules. **§5B** are the
supporting families. Each stage is one adjudicator-gated, PR-sized unit that fits the existing loop
(implement → inspectors → adjudicator → PR → CI green → auto-merge). Stage 1 is the smallest first
landing (the *local projection* of the spine); Stage 2 raises the transport-adversary harness itself
and is the plan's center of gravity.

### 5A. The streaming spine

#### The transport adversary (the harness)

The core test object is **the shipped Kyutai mapping reducer + `LocalAgreement` + `RollingTranscript`,
fed a fast-check-generated wire schedule**. No server, no websocket, no wall-clock — a schedule is
*data*, so it shrinks and replays like any other fixture. Model, over the Stage 6c protocol:

```ts
type Wire =
  | { kind: 'word'; text: string; startTime: number }     // committed token (final by Kyutai contract)
  | { kind: 'endWord'; stopTime: number }
  | { kind: 'step'; endOfTurnPr: number }                  // prs[2]; > 0.5 = semantic end-of-turn
  | { kind: 'marker'; id: number }                         // drain echo
  | { kind: 'ready' } | { kind: 'error'; message: string }

type NetEvent =
  | { kind: 'deliver'; wire: Wire }                        // ship the next pending message
  | { kind: 'duplicate'; wire: Wire }                      // wire re-delivers a message
  | { kind: 'drop'; wire: Wire }                           // …never delivered
  | { kind: 'reorderWindow'; span: number }                // permute the next `span` deliveries
  | { kind: 'reconnect' }                                  // socket drops; adapter resumes the turn
```

A generated schedule ends with a **quiescence drain** (deliver every outstanding message, no drops,
then a final `step` with `endOfTurnPr > 0.5`) so the convergence assertions have a well-defined final
state. This is the fast-check embodiment of "a hostile network can reorder / delay / duplicate / drop
messages, and the transcript the user already saw must not change."

#### Streaming invariants (asserted by the harness, enforced by shipped modules)

| Invariant | Assertion | Shipped module it exercises |
|---|---|---|
| **Prefix monotonicity (the promise)** | across the whole schedule, the emitted `stableUpTo` never decreases within a turn and each committed prefix is a prefix of every later one — a duplicated or reordered `word` never rewinds stable text | `mapping.ts` reducer, `LocalAgreement` |
| **Idempotence under duplication** | delivering the same `word`/`marker` twice yields the same committed state as delivering it once — no double-append, no offset skew | `mapping.ts` dedup path, `RollingTranscript.push` |
| **Endpoint determinism** | exactly one `isFinal` event per turn, fired iff a `step` with `endOfTurnPr > 0.5` was delivered; no partial emitted after the final within a turn | `mapping.ts` end-of-turn gate |
| **Reorder tolerance within bounds** | permuting deliveries inside a `reorderWindow` (Kyutai commits tokens in order, so bounded reorder is the only legal wire perturbation) converges to the same final transcript as in-order delivery | `mapping.ts`, `LocalAgreement` |
| **Resume without loss or dup** | a `reconnect` mid-turn resumes and the final transcript equals the no-reconnect run — no committed token dropped, none duplicated | adapter resume path + `mapping.ts` |

The first row is the whole thesis in one property: **the streaming promise is a monotonicity
invariant** — stable text stays stable while a hostile transport reorders, duplicates, and drops
messages under it. It composes the mapping reducer, the agreement stabilizer, and the rolling
transcript — all shipped code — so a green run proves those modules *are* the stabilization mechanism.

#### PROVES vs does-NOT-PROVE (kept honest — full boundary in §7 R3)

The in-memory harness proves the **protocol schema + stabilization + endpoint logic** converge under
any wire schedule. It does **not** prove the real `moshi-server` emits those messages, transcription
**accuracy** (WER), real websocket framing/backpressure timing, resample **audio quality** (only its
numeric invariants), or GPU latency. Those need the **on-hardware stage (6c.5)**, which is
**hardware-gated**: no CUDA on the Lunar Lake dev box, so real-weights STT runs on a separate
GPU-equipped host or is deferred to CI-with-GPU. See §7 R3.

### 5B. Supporting stages

#### Stage 1 — `test(voice): stable-prefix + rolling-transcript properties + fast-check` (§3, §4.1–4.2)
The **local projection** of the spine: single-stream reducer invariants (A–D) on `LocalAgreement`,
`RollingTranscript`, `EnergyVad`. fast-check dep, `pbt.ts`, `events.ts`, properties A–D, artifact
writer, purity guard, upload-artifact step. **Start here** — smallest valuable landing; needs no
Kyutai core, so it lands before the spike settles.

#### Stage 2 — `test(voice): kyutai mapping convergence under transport adversary (in-memory, no server)` — **the spine**
Builds the §5A wire-schedule harness against the shipped `mapping.ts` reducer and asserts every §5A
invariant, including prefix-monotonicity-under-reorder and resume-without-loss. In-memory, injected
fake transport (§7 R3). Test file `src/main/voice/kyutai/mapping.pbt.test.ts`; describe block carries
`[in-memory, no server]`; each property names its invariant (`[monotone]`, `[idempotent]`,
`[endpoint]`, `[reorder]`, `[resume]`). Reuses Stage 1's event vocabulary as the delivered payload.

#### Stage 3 — `test(voice): resampler + codec round-trip properties`
The pure Kyutai edges. Resampler (`resample.ts`): output length ≈ `round(N * 24000/16000)` within ±1,
every output sample within `[min(input), max(input)]` (linear interp is bounded), a constant input
maps to a constant output, and rechunk to 1920-sample blocks **conserves total sample count and
order** (concatenating the chunks reproduces the resampled stream, last chunk possibly short).
Codec (`codec.ts`): `decode(encode(m))` deep-equals `m` for every `Wire`/protocol message, with float
fields compared to `use_single_float` tolerance (msgpack single-precision round-trip is lossy by
design). Classic PBT sweet spot; runs at 10⁴ cases/sec.

#### Stage 4 — `test(voice): ring-buffer + window model-based machine`
`fc.commands` model-based testing. Commands = `push(frame)`/`read(n)`/`drain()`; system under test =
`SampleRingBuffer`; truth model = a plain array with the same capacity + eviction rule. After every
command: `drain()`/`read()` output equals the model's, `dropped` matches evicted count, `length ≤
capacity`. Same treatment for `StreamWindow` (append/shouldDecode/window/markDecoded vs a bounded
array). Also the home for the one **async** property: drive `StreamDecoder` with a synchronous fake
`DecodeFn`, apply a command list, `await drain()`, and assert the emitted `TranscriptEvent`s satisfy
prefix-monotonicity + exactly-one-final — the single-flight orchestration proven without a server.

#### Stage 5 — `test(voice): full-turn chaos sequences + main-tier budget`
Composes the whole pipeline: generated audio-frame RMS envelopes → `EnergyVad` → `StreamDecoder` with
a fake `DecodeFn` whose "transcription" is a deterministic function of the frames → assert the
end-to-end transcript is monotone and the turn count matches the VAD alternation, at **every** step
not just quiescence. Adds the main/stage-push heavier budget to `ci.yml` and the coverage ledger (§7
R4).

#### On-hardware — **hardware-gated, not scheduled here**
When a CUDA host is available (CI-with-GPU or a separate box), a `test(voice): moshi-server parity`
stage extends the §5A invariants onto the real server: committed-word/timestamp parity, semantic
end-of-turn, and endpointing parity vs the whisper energy-VAD endpointer (the Stage 6c.1 proof
metrics), plus a WER floor on a fixed clip set. It depends on hardware the dev box does not have; the
in-memory Stage 2 is the honest stand-in until then (§7 R3).

Not planned (right-sized out): nightly mega-campaigns, mutation testing, PBT through the packaged
Electron app (Playwright e2e stays example-based). AI generator evolution is **not** deferred — it is
a first-class authoring-time mechanism, §8.

## 6. CI tiering (this repo's reality)

Current CI (`ci.yml`): one `build-and-test` job on `windows-latest` — lint → typecheck → `test:unit`
→ `build:unpack` → Playwright. PBT rides the `test:unit` step; no new job, no matrix.

| Tier | Trigger | Budget | Mechanism |
|---|---|---|---|
| PR | `pull_request` → `main` | `PBT_RUNS=200` per property, fixed `PBT_SEED` — target ≤ 30s added to `test:unit` | `env:` on the `Unit tests` step |
| main / stage | `push` to `main` or `stage/**` | `PBT_RUNS=2000`, fixed seed **plus** a second campaign with `PBT_SEED=${{ github.run_number }}` — target ≤ 3 min | conditional env: `PBT_RUNS: ${{ github.event_name == 'push' && 2000 || 200 }}` |

- The rotating push seed buys cumulative state-space coverage over time without a scheduled job; it is
  printed in the log and lands in the failure artifact, so a red push run is still replayable
  (`PBT_SEED=<n> npm run test:unit`). PRs stay fully deterministic so a red PR check is always the
  PR's fault, never seed luck — this matters because the build loop auto-merges green PRs with no human
  in the loop.
- A push-only failure from a rotating seed cannot block a PR retroactively; the loop's response is
  mechanical: shrink → commit fixture to `regressions/` → fix — as its own gated stage/PR.
- Release-candidate tier: not applicable yet; if `release.yml` grows one, it is a manual
  `PBT_RUNS=20000 npm run test:unit`, not new CI.
- **AI-authored artifacts ride the same tiers, deterministically** (§8): committed AI fixtures run
  **by value** on every PR; `@exploratory` AI properties run but are **non-blocking on PR** until
  adjudicator-promoted. CI never invokes a model.

## 7. Risks and mitigations (honest)

### R1 — Node PBT can still leak non-determinism → flake

The reducers are pure today, but a property can still go non-deterministic through: `Date.now()`/
`Math.random()` slipping into a future reducer, real timers, or — the one live hazard here —
`StreamDecoder`'s `Promise` chain being awaited incorrectly.

**Mitigation — a determinism harness + a synchrony rule:**

1. **Purity guard in `runProperty` (`pbt.ts`).** For the duration of each `fc.assert`, replace
   `Math.random` with a seeded PRNG derived from `PBT_SEED`, freeze `Date.now`/`performance.now` to a
   constant, and assign a throwing stub to `setTimeout`/`setInterval`; restore all in a `finally`.
2. **Synchrony split.** Stage 1–3 and §5A properties are **synchronous** — `fc.assert` (sync form)
   throws on a thenable, enforcing it by construction. The only async surface, `StreamDecoder`, is
   confined to Stage 4, uses a synchronous fake `DecodeFn`, and is driven through its explicit
   `drain()` — the single deterministic await, no timers.
3. **Double-run self-check.** A meta-test runs one representative property twice with the same seed and
   asserts identical pass/fail + identical first counterexample — the canary for R1.
4. **Lint fence (when ESLint scope allows).** A `no-restricted-globals`/`no-restricted-syntax` rule
   scoped to `src/main/voice/pbt/**` bans `Date.now`, `performance.now`, `Math.random`, `setTimeout`,
   `setInterval` in property/interpreter files — a compile-time stop. The repo already gates on
   `npm run lint`, so this rides the existing check.

### R2 — fast-check version bump can shift seed→case generation

**Mitigation — fixtures replay by value, plus a canary:**

1. **Regression fixtures replay the concrete event list, never a seed.** The loader in
   `transcript.pbt.test.ts` does `import.meta.glob('./regressions/*.json', { eager: true })` and runs
   the **interpreter directly** on each fixture's event list, then asserts — never touching
   fast-check's generators, so an fc upgrade cannot change what a fixture exercises.
2. **Generator-drift canary.** One fixture is also stored with its `{ seed, path, fastCheckVersion }`
   and replayed by seed; its assertion is "replaying this seed still produces a case whose event-kind
   multiset matches the recorded one." An fc bump that reshuffles generation fails only this test,
   loudly, with a re-baseline instruction — value-based fixtures keep protecting real bugs.
3. `fast-check` pinned exact in `package.json`; dependabot bump PRs run the canary, so every upgrade
   carries an explicit "generation changed / didn't" signal.

### R3 — The spine must not over-claim on-hardware STT quality

A green convergence + monotonicity check is easy to misread as "voice works." It does not. The
streaming invariants are proven **at the protocol/stabilization/endpoint layer**, against a
**modelled** wire — not the shipped `moshi-server`, and never against WER.

**What the in-memory harness PROVES:** the mapping reducer + `LocalAgreement` + `RollingTranscript`
converge to one monotone transcript under any generated reorder/duplicate/drop/reconnect schedule;
exactly one end-of-turn per turn; stable text is never rewritten; resample and codec obey their
numeric round-trip laws.

**What it does NOT prove** (belongs to the hardware-gated 6c.5 parity stage, §5B): that `moshi-server`
actually emits those messages for real audio; transcription **accuracy** (WER); real websocket
framing, backpressure, reconnect *timing*; resample **audio quality**; GPU **latency** (TTFT, the
~500ms Kyutai delay). There is **no CUDA on the Lunar Lake dev box**, so this cannot be tested locally
— testing a mock of the server would prove nothing. The modelled wire is honest *because* it is
labelled a model everywhere it appears.

**Mitigation — make the boundary un-missable:**
1. Test file `src/main/voice/kyutai/mapping.pbt.test.ts`; top-level `describe` is
   `Kyutai mapping convergence (in-memory, MODELLED wire, NO moshi-server — see plan §7 R3)`; each
   property carries `[in-memory]` plus its invariant tag.
2. A banner at the top of the file enumerates the "does NOT prove" list, pointing to the
   hardware-gated `test(voice): moshi-server parity` stage.
3. The Stage 2 PR description states the boundary in one line; the Stage 6c handoff doc's status note
   says "streaming *schema + stabilization* proven under a modelled wire; *accuracy + latency* still
   need on-GPU 6c.5."

### R4 — "Green PR ≠ state space cleared": coverage honesty without a nightly farm

**Mitigation — a committed coverage ledger + a load-bearing rule:**
1. **Per-property "cases explored" report.** `runProperty` records, per property, `numRuns` executed
   plus a cheap structural tally — a set of *event-kind bigrams* (pairs of consecutive event kinds,
   e.g. `word→duplicate(word)`, `step→reconnect`) — and prints a table to the CI log:
   `property | runs | distinct bigrams seen / total possible`.
2. **Committed cumulative ledger `coverage-ledger.json`.** The **push** tier (rotating seed, §6)
   merges newly-seen bigrams into the ledger and commits it back (`[skip ci]` chore or follow-up
   automerge PR). Over weeks the explored frontier accrues with no nightly job. PRs read but never
   write it (keeps PR runs side-effect-free).
3. **Coverage regression guard.** A PR fails if it removes a property or drops a property's `numRuns`
   below the committed floor — stops silent coverage erosion.
4. **Load-bearing promotion rule.** A property is *load-bearing* only once (a) it caught a committed
   regression or pins a specific voice/protocol contract, (b) its bigram coverage passed a stated
   threshold, and (c) it survived ≥ N push campaigns without a spurious failure. Until then it is
   labeled `@exploratory` and a failure is triaged "possible spec bug in the property" before "product
   bug."

### Remaining tradeoffs (accepted, lower-stakes)

- **Time budget.** fast-check on the pure reducers runs ~10³–10⁴ cases/sec; 200 runs × ~8 properties
  is seconds on 8 cores. Stage 1 caps hypothesis-list length at ~40 and audio-frame counts at ~1s of
  frames to hold the PR budget. If `test:unit` creeps past ~90s total, drop `PBT_RUNS` before dropping
  properties.
- **Async shrinking (Stage 4 only).** Shrinking a `StreamDecoder` command list re-runs it against a
  fresh decoder + fake `DecodeFn` per attempt; the fake is a pure function of the frames so this stays
  deterministic. Kept out of Stages 1–3/5A so the fast paths never touch a Promise.
- **Oracle drift.** Property A/C encode the current `stableUpTo`/segment contract; a `TranscriptEvent`
  schema change (e.g. word-level timestamps added for the full-duplex migration) updates the
  properties with it. That is by design — the properties *are* the spec — but the adjudicator should
  treat a property *loosened* during a refactor as a red flag.

## 8. AI-generated PBT (authoring-time, CI-replayed)

First-class, and a natural fit for this repo's existing **inspector → adjudicator** build loop. The
AI acts as an **adversarial researcher** that invents wire schedules, expands generators, and proposes
invariants, under one hard line:

> **The AI runs at authoring time (offline). CI only ever replays committed, deterministic artifacts.
> CI never calls a model.** An AI-authored fixture is byte-identical to a hand-authored one by the
> time CI sees it — reconciling with R1 (purity) and R2 (value-based replay).

### 8.1 The loop (offline)
1. **Inputs:** recent failure artifacts (`test-results/pbt/*.failure.json`), the recent voice diff
   (esp. `src/main/voice/kyutai/`, `streaming/`), the existing generators, and the coverage ledger
   (§7 R4) to see which event-bigrams / invariant tags are under-explored.
2. **Output** (one of): a nastier wire schedule (e.g. "reconnect mid-word, redeliver the pre-drop
   tail, then end-of-turn"), a new generator variant + arbitrary, a batch of value-based fixtures, or
   a candidate invariant (prose + oracle + code stub).
3. Emitted as a committed artifact, opened as a normal PR.

### 8.2 Artifact format + storage
Segregated under `src/main/voice/pbt/ai/` so provenance is obvious in review/blame:
```
generators/<name>.ts     new Wire/NetEvent variants + fc arbitraries (deterministic; obey R1 fence)
fixtures/<name>.json      value-based cases: { events|schedule, expected, observed_at_capture, provenance }
candidates/<name>.md      proposed invariant: statement, oracle, why-sound argument, sabotage check
MANIFEST.json             { artifact, source: "ai", model, prompt_hash, created, status, reviewed_by }
```
Every fixture carries `"provenance": { "source": "ai", "model": "...", "reviewed_by": null }`. A
candidate invariant lands as a **failing-or-`@exploratory`** property plus its rationale — never a
silently-trusted gate.

### 8.3 How CI runs it
AI fixtures under `ai/fixtures/` are globbed and replayed **by value** exactly like R2 regressions —
no seed, no model, no network — riding the normal PR tier. An `ai/generators/` variant enters a
property only after adjudicator sign-off; until then its cases exist only as frozen fixtures, so CI
stays deterministic while the generator is under review.

### 8.4 The gate (AI proposal → load-bearing)
Ties to R4's promotion rule and the repo's adjudicator discipline (an AI-proposed oracle must **never**
silently become the source of truth):
1. Every AI artifact enters `@exploratory`: runs but does not block PR merges; a failure is triaged
   "possible bad AI property" before "product bug."
2. **Adjudicator review of the oracle for soundness** is mandatory before promotion — the adjudicator
   independently justifies *why the invariant is true of the voice pipeline*, not merely that the test
   passes. An oracle that just mirrors the reducer (tautology) is rejected.
3. Promotion to load-bearing requires R4's three conditions **and** the adjudicator sign-off recorded
   in `MANIFEST.json` (`reviewed_by` set). Only then does the property drop `@exploratory` and gate.
4. AI **never** decides pass/fail and **never** edits an existing human invariant — it only adds
   candidates. Deterministic PBT decides pass/fail; the AI proposes and explains; the adjudicator
   approves.

### 8.5 Q-track
Quality thread alongside the voice roadmap:
- **Q1** = Stage 1 (reducer monotonicity properties).
- **Q2** = Stage 2 (transport-adversary spine) — the load-bearing one.
- **Q3** = Stages 3–5 (resample/codec, ring-buffer/window model machine, full-turn chaos + CI tiering).
- **Q4** = AI-authored PBT (this section): `ai/` directory, `@exploratory` intake, adjudicator
  promotion. Depends on Q1–Q3 existing.
- **Q5 (hardware-gated)** = `moshi-server parity` (§5B, Stage 6c.5) once a CUDA host is available.

## 9. Immediate next action (Stage 1 checklist)

1. `npm i -D fast-check` (pin exact).
2. `src/main/voice/pbt/pbt.ts` — seed/runs env, artifact writer, **purity guard + double-run canary**
   (R1).
3. `src/main/voice/pbt/events.ts` — hypothesis + `TranscriptEvent` arbitraries with growing-prefix
   bias; reducer drivers over the shipped `LocalAgreement` / `RollingTranscript` / `EnergyVad`.
4. `src/main/voice/pbt/transcript.pbt.test.ts` — properties A–D + value-based regression loader (R2);
   `src/main/voice/pbt/regressions/` fixtures dir.
5. Sabotage-check each property catches its target bug (shrink the committed prefix, drop a final,
   double-fire the VAD); restore.
6. Add the `pbt-failures` upload-artifact step to `ci.yml` (adjudicator-gated CI edit).
7. Inspectors → adjudicator → PR `test(voice): stable-prefix + rolling-transcript properties +
   fast-check` with the `automerge` label.

(Coverage ledger R4 and the fast-check canary's push-commit path land with Stage 5's CI tiering;
Stage 1 ships the reporting hook in `runProperty` but not the committed ledger.)
