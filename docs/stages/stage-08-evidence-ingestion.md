# Stage 8 — Evidence ingestion (spreadsheets, code, repos) + knowledge-graph layer

Part of the [build plan](../build-plan.md) · Context to load: [ingestion](../architecture/ingestion.md) · [data-model](../architecture/data-model.md) · [ai-layer](../architecture/ai-layer.md)

Goal: inputs that prove what you did but can't say why it mattered — auto-draft, then ask. Heavy dumping starts here, so this is also where the entities/edges layer lands. Built on the Stage 1 design system: composes existing primitives, ships each screen's empty/loading/error/keyboard states, and honors the a11y + reduced-motion floor.

- [ ] 8.1 xlsx/csv: sheet flattening + numbers summary (Haiku) → draft with metrics prefilled → gap questions (Situation? Result? impact?) mandatory for evidence kind.
- [ ] 8.2 Code files/folders/archives: walk with `.gitignore`/size/binary filters → repomix-style packing → draft from structure, languages, README claims.
- [ ] 8.3 GitHub repo URL: REST tarball (optional PAT in safeStorage for private repos) → same packing path.
- [ ] 8.4 Evidence-specific confirm UI: "here's what I can prove — tell me the story around it."
- [ ] 8.5 Knowledge-graph layer: `entities`/`edges` migration; LLM entity extraction (people, teams, projects, tools) folded into the ingest confirm flow (extracted entities shown for approval alongside the STAR draft); backfill pass over existing experiences; Bank detail view gains a "connected to" panel (1–2-hop traversal: shared entities, shared skills).

**Checkpoint 8**: point at a real repo → a draft naming its languages/structure/README claims → answer the gap questions → confirmed, fully source-backed experience — and its extracted entities (project, tools) show up connected to related experiences in the Bank.
