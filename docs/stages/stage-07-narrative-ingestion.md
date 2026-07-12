# Stage 7 — Narrative ingestion (files, resume, URLs)

Part of the [build plan](../build-plan.md) · Context to load: [ingestion](../architecture/ingestion.md) · [data-model](../architecture/data-model.md)

Goal: bring in anything that already carries a story. Built on the Stage 1 design system: composes existing primitives, ships each screen's empty/loading/error/keyboard states, and honors the a11y + reduced-motion floor.

- [x] 7.1 Ingest framework: Extractor interface generalizing Stage 3's source persistence; imported files copied into the content-hash-named attachments dir (provenance survives moved/deleted originals); duplicate hash → offer to reuse the existing source; import wizard UI (drop zone + URL field); per-file review queue reusing the Stage-3 confirm flow.
- [x] 7.2 txt/md + docx (`mammoth`) + pdf (`pdfjs-dist`; graceful "this looks scanned" failure).
- [x] 7.3 Resume mode: multi-experience splitting — one document proposes N drafts, each reviewed separately.
- [x] 7.4 URL ingestion: fetch → readability → markdown → propose.
- [x] 7.5 Extractor tests against a real-file fixture corpus (incl. a real resume).

**Checkpoint 7**: drop a real resume PDF → several correct STAR drafts, each with its source visible on the experience detail view (not just in the DB); paste a blog URL → one draft.
