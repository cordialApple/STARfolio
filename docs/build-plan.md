# STARfolio — Build Plan (index)

Companion docs: [concept & user stories](starfolio-concept.md) · [architecture spec](architecture.md). Each stage lives in its own file under [`stages/`](stages/) — when working a stage, load **that stage's file plus the architecture topic files its header names; nothing else**. This index is for orientation and status.

Ordering logic: walking skeleton with all risk spikes first; local-only bank next (usable with zero AI); then the AI spine (brain dump + NL find); mode B completes the **MVP** (the full logger→job-seeker loop); practice and voice immediately after; then ingestion breadth + the knowledge-graph layer, the technical layer, written materials, and upkeep. Every stage ends with the app runnable and packageable.

| # | Stage | Delivers | Status |
|---|---|---|---|
| 0 | [Walking skeleton & risk spikes](stages/stage-00-skeleton.md) | packaged app proving sqlite-vec, streamed LLM, mic+whisper, embeddings | ☐ |
| 1 | [Experience bank (local-only core)](stages/stage-01-bank.md) | STAR form, drafts, browse/filter, keyword search — no key needed | ☐ |
| 2 | [AI spine: brain dump & NL find](stages/stage-02-ai-spine.md) | propose-then-confirm capture; hybrid retrieval + NL search | ☐ |
| 3 | [Mode B: on-demand stories — **MVP**](stages/stage-03-stories-mvp.md) | JD/genre → grounded, provenance-linked STAR story; tag `v0.1` | ☐ |
| 4 | [Mode A: live practice (text)](stages/stage-04-practice.md) | interviewer engine, feedback rubric, drill-downs, session history | ☐ |
| 5 | [Voice](stages/stage-05-voice.md) | push-to-talk STT (core), TTS toggle, streaming (stretch) | ☐ |
| 6 | [Narrative ingestion](stages/stage-06-narrative-ingestion.md) | files/resume/URLs → drafts with attached sources | ☐ |
| 7 | [Evidence ingestion + knowledge graph](stages/stage-07-evidence-ingestion.md) | spreadsheets/code/repos; entities/edges layer | ☐ |
| 8 | [Technical-interview layer (bonus)](stages/stage-08-technical-layer.md) | practice over your own reference corpus | ☐ |
| 9 | [Written materials (bonus)](stages/stage-09-written-materials.md) | JD-tailored resume bullets + resume export | ☐ |
| 10 | [Maintain, polish, distribute](stages/stage-10-maintain.md) | nudges, export/backup, updater, onboarding | ☐ |

Status legend: ☐ not started · ◐ in progress · ☑ checkpoint passed. Mark stage status here; check off individual steps inside the stage file.
