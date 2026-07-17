# Handoff — ASR (Stage 6b) + 3-tier routing

Written 2026-07-16 for a post-context-clear resume. User will paste short instructions; this holds the why.

## User's instruction (verbatim)
> start on pure asr, starting bg threads for unit and integration tests. i want you to work out ci and auto-merge for all of 6b (6b.1-3). notes on routing: opus builds map off job description AND resume. also i want to stress that haiku get guidance from sonnet, may need to short the ~15sec sonnet loop but that's an easy change so let's just start build

## What to do
1. **Build pure ASR first** — Stage 6b, `docs/stages/stage-06b-streaming-voice.md` (lives only on branch `docs/asr-restructure`, not merged to main yet — merge/settle that first so 6b is official). Scope this push: **all of 6b — 6b.1 → 6b.5** (spike, audio front-end, live partial transcripts, auto turn-taking, sustained latency/accuracy pass).
   - 6b.1 spike is the gate + highest risk: pick VAD (Silero ONNX / WebRTC / energy), prove streaming whisper decode holds **RTF < 1.0** on target hw (whisper is NOT a streaming model → sliding-window + local-agreement, partials get *revised*), prove half-duplex kills TTS→mic echo. Measure **end-to-end** latency (mic-close → audible reply), not just decode.
   - 6b.3 partial event contract: `{ text, stableUpTo }`. This is THE seam the routing consumes later — lock it.
   - 6b.4 auto turn-taking: end-of-utterance → send turn to interviewer engine; half-duplex handoff around TTS; push-to-talk stays selectable as fallback. 6b.5: sustained-streaming latency/accuracy pass on target hw, document chunk-latency + RTF budget next to the Stage 6 model ladder.
2. **Background test threads** — spin unit AND integration test generation on bg threads (Agent, run_in_background) so feature dev continues in parallel. User has asked for this pattern before ("send the test stuff to a background thread so we can also start doing dev").
3. **CI + auto-merge for all of 6b.1-3** — green-gated auto-merge PRs, same loop as prior stages. Per PR: issue → branch off `stage/11-maintain` → typecheck+lint → simplifier → 1-line conventional commit → `gh pr create --base main` → verify closingIssuesReferences → `gh pr checks N --watch` → `gh pr merge N --squash --delete-branch` → sync. All npm/gh/git from `app/`. CI = single windows-latest `build-and-test` (~5-7min).

## Routing (3-tier) — context for the ASR seam, see [[interview-model-routing]]
- **Opus** — pre-interview, once: builds the soft roadmap off **job description AND resume** (NOT resume alone — updated per this handoff).
- **Haiku** — hot path throughout, low-latency convo; **takes guidance FROM Sonnet** (stress: Sonnet→Haiku handoff is the point, Haiku is steered, not autonomous).
- **Sonnet** — background ~15s loop over the transcript stream: ranks roadmap for transitionability, assesses pacing/feedback/stories, feeds Haiku. **~15s may need shortening — easy change, don't block on tuning it, just build.**
- Routing is a **sibling** workstream, not part of 6b. Can prototype on today's push-to-talk text now; plugs into 6b.3's `{text, stableUpTo}` when ASR lands. 6b ships fine on today's blocking Sonnet-parse turn without it.

## Guardrails still in force
- `getSecret('anthropic_api_key')` = only path to the key. IPC handlers NEVER trust renderer-supplied filesystem paths (resolve from own DB); sessionIds from renderer are OK.
- Model IDs in one config module: Opus `claude-opus-4-8`, Sonnet `claude-sonnet-5`, Haiku `claude-haiku-4-5`.
- Web Speech API rejected (routes audio to Google/Azure — breaks privacy promise). Local whisper only.
- CLAUDE.md: caveman-full prose, no code comments (except non-obvious why), 1-line conventional commits, simplifier on non-trivial src diffs. pr-workflow skill: never commit on main, issue-before-PR, `Closes #N` on its own line.
