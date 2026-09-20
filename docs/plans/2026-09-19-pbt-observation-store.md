# PBT Observation Store Implementation Plan

**Goal:** Preserve every PBT campaign and failure as immutable evidence, keep later judgments separate, and retain safe CI cycles outside product history.

**Architecture:** `runProperty` emits campaign start, failure, and completion events into an atomic per-event store. A deterministic reader validates raw events and separate annotations without rewriting either layer. CI encrypts the exact bounded spool with a one-time content key, wraps that key with the repository public key, and uploads ciphertext plus a safe manifest. Trusted code from `main` decrypts, revalidates, and appends same-repository cycles to an orphan retention branch.

**Tech Stack:** TypeScript, Vitest, fast-check, Zod, Node filesystem and crypto APIs, GitHub Actions

---

### Task 1: Define schemas and deterministic serialization

**Files:**

- Create: `app/src/main/voice/pbt/observation-schema.ts`
- Create: `app/src/main/voice/pbt/observation-canonical.ts`
- Test: `app/src/main/voice/pbt/observation-schema.test.ts`

**Steps:**

1. Write failing tests for raw event variants, explicit nullable provenance, observation classes, annotation dispositions, and stable tagged serialization.
2. Run focused tests and confirm failures come from missing modules.
3. Add versioned Zod schemas, JSON-safe tagged serialization, and SHA-256 helpers.
4. Run focused tests until green.

### Task 2: Add immutable atomic store and reader

**Files:**

- Create: `app/src/main/voice/pbt/observation-store.ts`
- Test: `app/src/main/voice/pbt/observation-store.test.ts`
- Test helper: `app/src/main/voice/pbt/observation-writer.fixture.ts`

**Steps:**

1. Write failing tests for repeated events, concurrent writers, partial writes, malformed files, deterministic reads, annotation linkage, and unavailable provenance.
2. Run focused tests and verify expected failures.
3. Add exclusive temp writes, fsync, atomic rename, immutable event filenames, append-only annotation files, and diagnostics that preserve bad bytes.
4. Run focused tests until green.
5. Commit with `feat(pbt): add append-only observation store`.

### Task 3: Record complete campaigns through `runProperty`

**Files:**

- Modify: `app/src/main/voice/pbt/pbt.ts`
- Modify: `app/src/main/voice/pbt/pbt.self.test.ts`
- Modify: 11 existing `app/src/**/*.pbt.test.ts` files

**Steps:**

1. Write failing harness tests for zero-failure campaigns, repeated failures, replay metadata, generated and skipped denominators, stable fingerprints, unique event IDs, termination, and organic versus sabotage separation.
2. Run focused tests and verify expected failures.
3. Require explicit property version, invariant, observation class, and synthetic publication metadata.
4. Emit start, failure, and completion events without changing property outcomes or recording generated cases individually.
5. Run harness and all product property tests until green.
6. Commit with `feat(pbt): record complete property campaigns`.

### Task 4: Stage safe cycles and retain CI evidence

**Files:**

- Create: `app/src/main/voice/pbt/observation-publication.ts`
- Create: `app/src/main/voice/pbt/retention-cli.ts`
- Create: `app/src/main/voice/pbt/retention-append.ts`
- Create: `app/src/main/voice/pbt/retention-append-cli.ts`
- Create: `app/src/main/voice/pbt/observation-publication.test.ts`
- Create: `app/src/main/voice/pbt/retention-append.test.ts`
- Create: `app/tests/unit/pbt-workflow.test.ts`
- Modify: `app/package.json`
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/pbt-pr-capture.yml`
- Create: `.github/workflows/pbt-retention.yml`
- Create: `.github/workflows/pbt-stage-capture.yml`

**Steps:**

1. Write failing tests for encrypted publication, unknown provenance, exact malformed preservation, cycle manifests, upload contracts, and trusted main-only retention.
2. Run focused tests and verify expected failures.
3. Add bounded encryption with AES-256-GCM, RSA-OAEP-SHA256 key wrapping, key identity, ciphertext hashes, and diagnostics that expose no record content or source path.
4. Encrypt main-push cycles with reviewed code. Run pull request PBT inside an isolated container, then encrypt with trusted base-branch code before uploading only `payload.enc` and `manifest.json`.
5. Retain same-repository PR cycles directly from their base-owned workflow. Add trusted `workflow_run` paths for `main` and `stage/**`, resolving private keys by key ID and quarantining invalid records while preserving exact encrypted bytes and valid peers.
6. Run focused tests until green.
7. Commit with `ci(pbt): retain trusted observation cycles`.

### Task 5: Document boundaries and run full gates

**Files:**

- Modify: `docs/plans/pbt-in-ci.md`
- Modify: `CONTEXT.md`

**Steps:**

1. Document raw versus annotation layers, local spool location, encrypted 90-day artifact transport, durable branch retention, privacy behavior, and observer limits.
2. Run lint, typecheck, full unit and integration tests, product PBT tests, package build, and Electron E2E.
3. Run simplifier once, then focused inspectors and adjudication.
4. Commit with `docs(pbt): document observation retention`.
5. Push, open a concise PR that closes issue #319, and merge only after hosted gates pass.
6. Post-merge, verify retained and reopenable `main`, same-repository PR, and `stage/**` cycles before creating the Luna observer.
