# PBT agent checkpoint plan

Issue: #326

## Goal

Preserve property failures that an agent observes and fixes before its first commit or pull request.
Capture stays deterministic. Model review remains downstream and optional.

## Contract

- A command wrapper hashes the tracked and untracked worktree state before it starts a test command.
- Version 2 raw events record the agent run ID, command step ID, and worktree state hash. Missing values stay `null`.
- Version 1 events remain readable.
- After the command exits, the wrapper snapshots only files not present in its durable local cursor.
- Exact raw, annotation, malformed, and partial bytes enter the encrypted checkpoint.
- The checkpoint is decrypted and validated before durable append.
- The cursor advances atomically only after the durable branch accepts the exact cycle.
- Test failure status still reaches the caller after capture completes.
- Capture does not classify a defect or link it to a fix.

## TDD sequence

1. Add failing schema and provenance tests for version 2 agent fields and version 1 compatibility.
2. Add failing delta tests for unseen files, repeated events, malformed bytes, and atomic cursor recovery.
3. Add failing wrapper tests for dirty-state identity, child exit propagation, zero-event commands, and publish failure.
4. Implement the smallest schema, delta store, and wrapper needed to pass.
5. Add a package command and focused procedure documentation.
6. Run unit, type, integration, privacy, and durable reopen checks.
7. Exercise the wrapper during one real agent development slice. Report no failure when none occurs.

## Merge gate

Merge only when a failure created before any commit survives its later fix, squash merge, branch deletion,
worktree removal, and durable-cycle reopen without raw mutation or plaintext publication.
