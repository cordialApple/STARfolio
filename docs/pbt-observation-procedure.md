# PBT observation procedure

This is a read-only review procedure for retained PBT evidence. It is not an automation, capture
dependency, defect classifier, analytics job, or product-code workflow.

## Inputs

- A checkout of the durable `pbt-observations` branch.
- The private-key keyring needed to reopen retained encrypted cycles.
- A stored cursor containing event IDs already inspected.
- An external append-only PBT ledger for failure occurrences and campaign denominators.
- Linked review or adjudication records when a disposition already exists.

The cursor and observer ledger are not implemented in STARfolio. Their storage and later analysis
belong to a separate data-engineering decision. Do not invent either location during a review.

## Procedure

1. Refresh the durable branch without changing or deleting retained cycles.
2. Reopen each candidate cycle with the deterministic reader. Treat malformed bytes, failed
   authentication, invalid provenance, broken annotation links, and missing durable artifacts as
   reportable conditions, not facts to repair.
3. Select only event IDs absent from the supplied cursor.
4. Append every unseen `failure-observed` occurrence to the external ledger before judging it.
   Preserve its event ID, campaign ID, property identity and version, invariant, incident
   fingerprint, counterexample hash, cycle identity, provenance, and raw-record reference.
5. Append campaign summaries with requested runs, executed runs, generated cases, skipped cases, and
   termination status. Zero-failure campaigns remain part of the denominator.
6. Keep organic, mutation, and sabotage observations separate. A repeated fingerprint groups
   manifestations but never deletes an occurrence.
7. Read later annotations and dispositions only after raw occurrences and denominators are durable.
   Nothing is confirmed without linked review or adjudication evidence.
8. Advance the cursor only after every selected occurrence and campaign summary is durably appended.
9. Produce a short delta report. Stay quiet when no event ID or integrity condition changed.

Never edit product code, rerun a failure, merge a branch, rewrite facts, delete records, infer missing
values, aggregate findings, or generate conclusions while performing this procedure.

## First real agent cycle

The first real local checkpoint run retained cycle
`agent-8c6b8db391f5baf7acc64665a23ecb68` after PR #327 merged and while the Windows
launcher fix was still uncommitted.

- 90 unique raw events
- 45 campaign starts and 45 matching completions
- 9,000 requested and 9,000 executed cases
- 42 organic campaigns and 3 sabotage campaigns
- 0 failure observations, annotations, or diagnostics
- matching pre-command and post-command worktree-state hashes

This is a capture and denominator check only. It supports no defect-yield conclusion. The invocation
did expose `spawn npm ENOENT` before the property suite began; issue #328 and PR #329 fixed that
launcher defect, but it is not a PBT failure and does not belong in the PBT failure ledger.
