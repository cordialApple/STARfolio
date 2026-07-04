# Architecture — AI Layer

Part of the [architecture spec](../architecture.md)

- **Routing**: Haiku (`claude-haiku-4-5`) for STAR extraction, gap detection, tagging — cheap, schema-strict. Sonnet (`claude-sonnet-5`) for interviewing, feedback, and story generation. Model IDs live in one config module — they will rotate.
- **Structured output**: every extraction call uses `client.messages.parse()` + `zodOutputFormat` (or strict tool-use) so drafts land as validated objects; branch on `stop_reason: "refusal"` before reading content.
- **Prompt caching**: `cache_control` on the stable interviewer system prompt + rubric + retrieved-experience context; verify via `usage.cache_read_input_tokens`; no timestamps or nondeterministic JSON in cached prefixes.
- **Grounding ("nothing gets invented")**: generation prompts receive *only* retrieved experience/source content; instructions require marking gaps rather than filling them; every story stores `experience_ids_json` and the UI renders "built from: …" links back to experiences and their sources. Extraction prompts distinguish *extracted* vs *needs-user-input* fields — that split drives the propose-then-confirm UI. Ingested source text (web pages, READMEs) is always framed as data, never instructions — a hostile README must not be able to steer the STAR proposer; propose-then-confirm is the human backstop.
- **Test seam**: the AI module has a record/replay transport — recorded fixtures keyed by prompt hash, plus a deterministic stub. All e2e tests run against it; live API calls are reserved for manual checkpoint verification. No API key or nondeterministic assertions in CI.
- **Cost**: every call logs to `usage_log`; Settings shows a running spend estimate. Research estimate at student usage: mock interview ≈ $0.05–0.15, extraction ≈ $0.002–0.006 → a few dollars/month.
