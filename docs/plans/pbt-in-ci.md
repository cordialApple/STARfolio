# Property-based testing in CI

Property tests protect state-evolution contracts that example tests miss. STARfolio has 45 property
calls across 11 files. The default 200-run campaign requests 9,000 executions per full pass. Failed
preconditions increase the generated-case count without inflating executed runs.

## Observation contract

Every `runProperty` call carries an explicit property ID, property version, invariant, observation
class, and publication class. The harness records three raw event kinds:

- `campaign-started`
- `failure-observed`
- `campaign-completed`

Campaign completion records requested runs, executed runs, generated cases, skipped cases, and
failure count. A green campaign still produces start and completion events. Generated cases are
counted per campaign, not stored one by one.

Failure events include the seed, replay path, requested and executed runs, generated and skipped
cases, shrink count, tagged raw counterexample, counterexample hash, exact failure text, environment,
termination status, and allowlisted Git and CI provenance. Counterexample and failure-text capture
status distinguish absent values from failed conversion. Capture failures keep their error and do
not mint a false fingerprint. Unavailable provenance is `null`. It is not reconstructed later.

Every occurrence gets a unique event ID. The incident fingerprint groups repeats by property ID,
property version, invariant, and counterexample hash. Repeated failures remain separate events.

Organic, mutation, and sabotage observations are distinct. Mutation and sabotage measure harness
sensitivity. They are not evidence of realized organic defect yield.

## Append-only storage

Raw observations and annotations are separate layers. Raw files are never rewritten. Each event is
written to a unique temporary file, flushed, and atomically renamed under an exclusive event lock.
Concurrent workers cannot share or truncate one JSONL file.

Annotations have their own ID, timestamp, author, target event, and publication class. Their kind
strictly selects a correction, classification, duplicate link, or disposition payload. Confirmed
code bugs require typed review or adjudication evidence. Supported dispositions are:

- `confirmed-code-bug`
- `oracle-bug`
- `generator-bug`
- `duplicate`
- `flake`
- `expected-sabotage`
- `unresolved`

Capture never assigns a disposition. A confirmed classification requires later review or
adjudication evidence. An annotation may target an event from an earlier retained cycle. Cycle
validation preserves that link. Writers reject unknown references by default; cross-cycle writers
must supply event IDs from the retained ledger. Ledger-wide readers and the observer verify links
against the same retained set.

The reader sorts valid records deterministically and reports malformed files, incomplete temporary
writes, stale locks, and broken annotation links. It does not move, repair, delete, or reinterpret
those bytes.

## Retention behavior

Local observations default to the repository Git common directory at
`.git/pbt-observations`. This survives test reruns, source branch deletion, squash merge, and worktree
removal. It does not survive deletion of the repository itself. `PBT_SPOOL_DIR` can select another
durable local path.

CI stages each run and attempt as one encrypted cycle. The source job takes a bounded snapshot and
puts every exact raw, annotation, malformed, and partial byte into one AES-256-GCM payload. A random
content key encrypts each cycle. RSA-OAEP-SHA256 wraps that key with the committed public key at
`.github/pbt-observation-public.pem`. The envelope records a SHA-256 public-key ID so retained cycles
remain attributable if keys rotate. Every historical private key must remain available for its key
ID in the JSON keyring stored as `PBT_OBSERVATION_PRIVATE_KEYS`. Private keys never enter source
control.

The uploaded artifact contains only `payload.enc` and a public manifest. The manifest exposes cycle
identity, encryption parameters, ciphertext size and hash, and safe diagnostics. A diagnostic has an
opaque ID, layer, reason category, safe issue codes, and byte count. It does not expose a source
filename, evidence hash, raw text, event ID, or annotation ID. Credentials and interview text have no
plaintext path into the artifact.

Only captured paths execute property tests: `main` CI, the base-owned pull request workflow, and the
trusted stage workflow. Ordinary pull request and `stage/**` CI still run unit and integration tests
but exclude property files, preventing an uncaptured first PBT run. Main pushes encrypt with reviewed
code from `main`. Pull requests use the base-owned
`pull_request_target` workflow. Candidate PBT runs inside Docker with a read-only source mount, a
writable spool, explicit provenance, and no secrets. Reviewed code and the committed public key then
encrypt the spool outside that container. GitHub Actions uploads the encrypted cycle even when tests
fail or the spool contains only malformed or partial evidence. Artifacts retain for 90 days. They
are transport, not the permanent ledger. Deleting a workflow run also deletes its artifact.

Same-repository pull requests validate and retain their encrypted cycle inside the base-owned
workflow, using the pull request head SHA and branch directly. A separate `workflow_run` path handles
`main` CI pushes. Another trusted `workflow_run` path reruns `stage/**` property tests in the same
isolated candidate container before validation and retention. None depend on a pull request
association. Trusted code from `main` reads the JSON keyring from
`PBT_OBSERVATION_PRIVATE_KEYS`, decrypts the payload, and revalidates schemas, provenance, links,
campaign consistency, counterexample hashes, incident fingerprints, diagnostics, and ciphertext
integrity. A bad record or campaign is omitted from the validated ID lists and described by a safe
diagnostic; its exact bytes remain in the ciphertext and valid peers still retain. The trusted
manifest keeps the complete encryption envelope beside the same ciphertext, so the durable pair
remains decryptable after transport expiry. The orphan `pbt-observations` branch keeps that pair
outside product history. The tested appender retries from the latest branch tip and treats an
identical cycle as idempotent. Retention jobs share one non-cancelling concurrency group, then retain
their run ID and attempt as the immutable cycle key.

The durable manifest can be reopened directly with the private-key keyring. Reopening verifies the
ciphertext, selects the key by ID, decrypts the exact payload, and checks the trusted manifest against
the decrypted evidence.

The trusted manifest is not independently signed. Its provenance relies on the trusted validation
job, GitHub artifact transfer, and repository branch history. Add separate attestation before using
retained cycles outside that boundary.

Real interview data, pasted career material, credentials, and unknown-origin fixtures still do not
belong in the synthetic PBT harness. Encryption is the publication boundary if they appear anyway.
Trusted validation excludes records not explicitly marked `synthetic` from validated event and
annotation IDs while preserving their exact bytes inside the encrypted payload for diagnosis.

## Current limits

Property tests still use a fixed seed and 200-run default in pull requests and on `main`. A later
slice may add measured PR and push budgets plus rotating seeds. That work must preserve the campaign
denominator and replay metadata.

Modelled-wire properties do not prove live Kyutai or MoshiRAG compatibility, speech quality, latency,
rigor, or hardware teardown. Issue #312 remains the live GPU evidence gate.

No dashboard, aggregate metric, yield estimate, or automated conclusion belongs in this capture
layer. Analysis remains downstream work.

The new default-branch workflow triggers cannot be proven by their introducing pull request. After
merge, verify one retained `main` cycle and one same-repository pull request cycle, reopen their
encrypted evidence from `pbt-observations`, and confirm `stage/**` retention before enabling Luna.
