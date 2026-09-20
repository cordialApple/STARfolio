# Property-based testing in CI

Property tests protect state-evolution contracts that example tests miss: stable transcript prefixes,
single end-of-turn delivery, codec round trips, resampler continuity, transport ordering, and intent
realization under duplicated or reordered events.

## Landed

- `fast-check` 4.9.0 is pinned.
- `voice/pbt/pbt.ts` owns the deterministic seed and run count.
- Rolling transcript, Kyutai mapping, codec, resampler, and TTS adapter properties run inside the
  normal Vitest suite.
- Kyutai protocol, codec, resampler, mapping, transport, adapter, session, and stub files exist.
- CI runs these properties through the combined unit and integration gate.
- Tests use the modelled wire only. They do not claim live service compatibility, speech quality,
  latency, or hardware teardown.

## Remaining CI work

### Tiered campaigns

Keep pull requests deterministic and short. Add a larger push campaign only after its runtime and
failure handling are measured.

- Pull request: fixed seed and the current 200-run default.
- Main push: fixed campaign plus a rotating run-number seed with a documented upper time bound.
- Every failing log prints seed, path, and run count so it can be replayed locally.

Do not auto-merge from a green property run. Properties are one merge gate inside the normal review,
inspection, adjudication, and current-base CI flow.

### Failure artifacts

When shrinking finds a counterexample, write a small value-based artifact containing the initial state,
operations, expected value, observed value, seed, and path. Upload it on CI failure. After review,
promote the minimized case into a committed seed-independent regression fixture.

CI must never commit to the repository. A developer or follow-up PR owns fixture promotion.

### Coverage ledger

Track useful structural coverage, such as event-kind pairs, without treating run count as proof. A
property becomes load-bearing only when it pins a real contract, catches its sabotage case, and remains
stable across repeated campaigns. The ledger is review evidence, not a bot-authored source of truth.

### AI-authored cases

Models may propose fixtures, generators, or invariants offline. CI only replays committed deterministic
artifacts and never calls a model. New AI-authored oracles remain exploratory until a reviewer can
justify why the invariant is true and an adjudicator accepts it.

### Hardware boundary

Modelled-wire properties do not prove the real Kyutai or MoshiRAG service. Stage 6c needs an explicit
accelerator target before live protocol and endpoint tests. Stage 6e live interview, rigor, and teardown
evidence remains issue #312. Hardware tests must report unavailable or failed explicitly; they never
silently skip and appear green.

## Next slice

Raise one focused issue for CI tiering and artifacts. Add the pull-request versus main-push budgets,
rotating seed, replay metadata, and failure upload together, with repeated hosted runs proving the gate
is stable before merge.
