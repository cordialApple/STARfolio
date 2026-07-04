# Stage 1 — Experience bank (local-only core)

Part of the [build plan](../build-plan.md) · Context to load: [data-model](../architecture/data-model.md) · [process-and-ipc](../architecture/process-and-ipc.md)

Goal: capture and browse work fully offline; the app is already useful with no key.

- [ ] 1.1 Full schema migration (entities + joins + FTS **with sync triggers**; vec table can wait for Stage 2's queue).
- [ ] 1.2 Guided STAR form: STAR fields, context, date range, skills/tags (autocomplete-with-create), metrics; save as draft or confirmed; edit/delete.
- [ ] 1.3 Bank view: list + filters (skill, tag, context, date, status) + FTS5 keyword search; experience detail view; drafts surfaced for finishing.
- [ ] 1.4 Repository unit tests; e2e: create → filter → edit → confirm.

**Checkpoint 1**: log 5 real experiences (some drafts), find them by filter and keyword, relaunch — everything persists.
