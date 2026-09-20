# Git conventions

Git history should read like deliberate human work, not agent bookkeeping.

## Issues and branches

- Raise the issue before implementation.
- Keep one reviewable outcome per branch.
- Name branches `<type>/<short-kebab-purpose>`.
- Use `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, or `chore` as the type.
- Prefer two to five plain words after the slash: `feat/remote-moshirag-worker`.
- Do not use agent names, timestamps, ticket dumps, or generated identifiers.

## Commits

- Use one line: `type(scope): summary`.
- Keep the summary imperative, direct, and specific.
- Do not add a body. Split work when one line cannot describe it honestly.
- Keep commits cohesive while developing. Squash the PR into one clean project-history commit.

## Pull requests

- Match the title to the final Conventional Commit.
- Keep the body under 200 characters.
- State the outcome, the important boundary, and the closing issue. Skip implementation narration.
- Merge only code worth keeping: current-base CI green, review findings adjudicated, and no known blocker
  hidden behind a retry.
- Delete the branch after merge.

## Quality gate

1. Write a focused failing test for changed behavior.
2. Implement the smallest complete slice.
3. Run unit tests and relevant integration tests during development.
4. Run feature E2E when the slice crosses a user or process boundary.
5. Simplify once, then run focused inspectors and adjudicate their findings.
6. Rebase or merge the current base, rerun the required gates, and open the PR.
7. Squash merge only after hosted CI passes.

Docs-only changes skip code simplification. Live hardware claims require live hardware evidence.

## Code shape

- Write code that explains itself through names, types, and boundaries.
- Add no comment unless a non-obvious why, workaround, gotcha, required pragma, or file convention
  cannot be derived from the code. Keep every new comment to one line.
- Apply SOLID principles where they create a real seam or isolate a reason to change.
- Use established design patterns when they make ownership or substitution clearer; do not add pattern
  ceremony to simple code.
- Choose data structures for the operations and invariants they must support, not convenience alone.
