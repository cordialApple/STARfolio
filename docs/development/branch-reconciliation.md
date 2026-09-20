# Branch reconciliation

Snapshot: 2026-09-19 after PR #317 merged.

## Result

Only `main` and the active `docs/reconcile-development-roadmap` branch remain locally. The remote has
only `main` until the docs branch publishes. Old superseded worktrees are removed.

## Reconciliation rules used

- Delete a normal branch when its tip is an ancestor of `main`.
- For squash merges, compare the branch tree and patch with `main`; ancestry alone is not evidence.
- Delete a patch-equivalent branch only after locating the merged PR or matching patch.
- Preserve unique files before removing a worktree.
- Leave genuinely unique unresolved work alone and record its next owner.

## Resolved groups

- Ancestor branches: `cov-probe`, `feat/kyutai-stt-spike`, `feat/structured-provider-seam`,
  `stage/11-maintain`, `test/scratch`, and the generated worktree branch.
- Patch-equivalent branches: `dev-preview`, `feat/6b-steering-loop`, `feat/clear-search`,
  `feat/pr5-multiprovider-prefs`, both `fix/*` branches, and the three `refactor/*` branches.
- Superseded MoshiRAG branches: the checkpoint, both `codex/*` plans, `docs/asr-restructure`, the source
  consolidation branch, and the recorder/worker/interview delivery branches.
- Remote cleanup: deleted `stage/11-maintain` and pruned the two merged MoshiRAG tracking refs.

The unique untracked MoshiRAG execution plan was condensed into
[`docs/plans/2026-09-19-remote-moshirag-pr-pass.md`](../plans/2026-09-19-remote-moshirag-pr-pass.md)
before its worktree was removed.
