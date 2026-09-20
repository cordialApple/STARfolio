# PBT agent checkpoints

This procedure preserves property failures that occur while an agent is still editing. It runs
outside model judgment. Capture does not depend on Sol, Luna, an issue, a commit, or a pull request.

Start one run ID for the development slice. Keep it for each property-test command in that slice.

```powershell
$env:PBT_AGENT_RUN_ID = [guid]::NewGuid().ToString()
cd app
npm run pbt:checkpoint -- npm run test:unit -- src/main/voice/example.pbt.test.ts
```

The wrapper hashes the worktree before launching the command. `runProperty` writes version 2 events
with the run ID, command step ID, and worktree-state hash. The child receives an allowlist of system
runtime variables plus isolated home, application-data, cache, and temporary directories. It does not
inherit repository, cloud, or retention secrets. When the command ends, the wrapper hashes the
worktree again. A changed or unavailable state keeps the exact encrypted bytes but excludes both raw
and annotation IDs from trusted evidence.

Each step uses its own spool. A step journal exists before the command starts. After the command, the
wrapper stages unseen exact bytes, encrypts them, validates them with local-agent authority, appends
the cycle to `pbt-observations`, verifies the remote commit is reachable, then writes immutable local
receipts. Pending or interrupted steps retry with their original authority. A failing test still
returns its original exit code after capture succeeds.

Use the wrapper again after the fix. The later campaign gets a new step ID and worktree-state hash.
The raw failure remains unchanged. Any classification or disposition remains a later annotation.

The committed public key encrypts the checkpoint. Local validation reads the private key from
`.git/pbt-observation-private.pem` by default. `PBT_OBSERVATION_PRIVATE_KEY_PATH` may name another
local file. GitHub Actions uses the separate `PBT_OBSERVATION_PRIVATE_KEYS` repository secret. Never
place private-key text in source, command arguments, logs, or workflow artifacts.

If durable publication fails, no receipt advances. The next checkpoint retries the same step before
running new work. If a command creates no unseen PBT bytes, nothing publishes. Removing the feature
branch or worktree does not remove a verified cycle from `pbt-observations`.

Synthetic tests prove the mechanism. They do not count as organic failures. A real development pass
only supports a failure-to-fix claim when the retained raw events show the same agent run and property
across distinct pre-fix and post-fix worktree identities.
