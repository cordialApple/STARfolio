# STARfolio — Build Plan (index)

Companion docs: [concept & user stories](starfolio-concept.md) · [architecture spec](architecture.md). Each stage lives in its own file under [`stages/`](stages/) — when working a stage, load **that stage's file plus the architecture topic files its header names; nothing else**. This index is for orientation and status.

Ordering logic: walking skeleton with all risk spikes first; then a lean design system — tokens, ~10 primitives, the STAR 4-beat signature, and an a11y + reduced-motion floor — that every later stage composes so features ship polished, not restyled; local-only bank next (usable with zero AI); then the AI spine (brain dump + NL find); mode B completes the **MVP** (the full logger→job-seeker loop); practice and voice immediately after; then ingestion breadth + the knowledge-graph layer, the technical layer, written materials, and upkeep. Every stage ends with the app runnable and packageable.

| # | Stage | Delivers | Status |
|---|---|---|---|
| 0 | [Walking skeleton & risk spikes](stages/stage-00-skeleton.md) | packaged app proving sqlite-vec, streamed LLM, mic+whisper, embeddings | ☑ |
| 1 | [Design system & signature UI](stages/stage-01-design-system.md) | tokens, ~10 primitives, STAR 4-beat rail motif, motion + a11y floor, preview route | ☑ |
| 2 | [Experience bank (local-only core)](stages/stage-02-bank.md) | STAR form, drafts, browse/filter, keyword search — no key needed | ☑ |
| 3 | [AI spine: brain dump & NL find](stages/stage-03-ai-spine.md) | propose-then-confirm capture; hybrid retrieval + NL search | ☑ |
| 4 | [Mode B: on-demand stories — **MVP**](stages/stage-04-stories-mvp.md) | JD/genre → grounded, provenance-linked STAR story; tag `v0.1` | ☑ |
| 5 | [Mode A: live practice (text)](stages/stage-05-practice.md) | interviewer engine, feedback rubric, drill-downs, session history | ☑ |
| 6 | [Voice](stages/stage-06-voice.md) | push-to-talk STT (core), TTS toggle, streaming (stretch) | ☑ |
| 7 | [Narrative ingestion](stages/stage-07-narrative-ingestion.md) | files/resume/URLs → drafts with attached sources | ☐ |
| 8 | [Evidence ingestion + knowledge graph](stages/stage-08-evidence-ingestion.md) | spreadsheets/code/repos; entities/edges layer | ☐ |
| 9 | [Technical-interview layer (bonus)](stages/stage-09-technical-layer.md) | practice over your own reference corpus | ☐ |
| 10 | [Written materials (bonus)](stages/stage-10-written-materials.md) | JD-tailored resume bullets + resume export | ☐ |
| 11 | [Maintain, polish, distribute](stages/stage-11-maintain.md) | nudges, export/backup, updater, onboarding | ☐ |

Status legend: ☐ not started · ◐ in progress · ☑ checkpoint passed. Mark stage status here; check off individual steps inside the stage file.
