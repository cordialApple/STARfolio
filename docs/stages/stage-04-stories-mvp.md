# Stage 4 — Mode B: on-demand stories → **MVP**

Part of the [build plan](../build-plan.md) · Context to load: [ai-layer](../architecture/ai-layer.md) · [retrieval](../architecture/retrieval.md) · [data-model](../architecture/data-model.md)

Goal: the payoff loop — bank in, ready-to-say story out. Built on the Stage 1 design system: composes existing primitives, ships each screen's empty/loading/error/keyboard states, and honors the a11y + reduced-motion floor.

- [ ] 4.1 Generate page: prompt by genre, pasted job description, or discipline; JD/genre → retrieval query → top experiences (user can swap the selection).
- [ ] 4.2 Grounded story generation (Sonnet, streamed): polished STAR answer from selected experiences only; gaps marked, never filled; length/tone presets (30s / 90s / detailed).
- [ ] 4.3 Story persistence with `experience_ids` provenance links; copy-to-clipboard; regenerate-with-notes.
- [ ] 4.4 e2e (replay transport): seeded bank → JD paste → story cites the expected experiences.

**Checkpoint 4 = MVP**: full loop — brain-dump three experiences over a "semester", paste a JD, get a polished, provenance-linked story in under a minute. Packaged build tagged `v0.1`.
