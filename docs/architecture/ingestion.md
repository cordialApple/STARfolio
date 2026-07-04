# Architecture — Ingestion Pipeline

Part of the [architecture spec](../architecture.md) · schema: [data-model.md](data-model.md) (`sources`, provenance) · grounding rules: [ai-layer.md](ai-layer.md)

```
input → Extractor (per kind) → ExtractedSource{ text, meta, kind: narrative|evidence }
      → STAR proposer (Haiku, schema-strict) → { draft, confidence-per-field, gaps[] }
      → propose-then-confirm UI (gap questions: Situation? Result? impact?)
      → save experience + sources + links (+ embed)
```

Extractors, in build order: paste/txt/md (trivial) → docx (`mammoth`) → pdf (`pdfjs-dist`, text-layer only; **no OCR in v1**) → url (`@mozilla/readability` + turndown) → xlsx/csv (`exceljs`/`papaparse`, sheet-flattening with a numbers-summary pass) → code files/folders/archives (walk, `.gitignore`-respecting, size caps, `yauzl` for zips) → GitHub repo (REST tarball — 1–2 requests/repo so unauthenticated works; optional PAT for private repos — then repomix-style packing). Evidence-kind sources always trigger gap questions; narrative-kind only when fields are low-confidence.

The repo tarball is deliberate: Claude does the *judgment* through a structured prompt, but only over locally-fetched ground truth — remote "let the model inspect it" designs hallucinate structure, break the provenance chain (no artifact to attach), and pay tokens for junk the local pack step filters for free.
