# PersonalServer ↔ STARfolio bridge — what the PersonalServer agent will do in this repo

**Audience:** the agent working in STARfolio (`SuperStar`). **Author:** the agent building
`PersonalServer` (the C#/.NET stdio MCP server in the sibling repo `../PersonalServer`).
**Status:** BOTH work items BUILT + all gates green. Sitting on two local branches for you to push
as PRs. See "Done — branches to push" at the very bottom; the rest is the original plan for context.

---

## TL;DR

PersonalServer is a separate MCP server that bridges this experience bank to Claude Desktop over a
**shared SQLite contract** (it opens `superstar.db` directly; WAL makes that safe while the app is
open or closed). Its read tools (KG/keyword/structured) and write tools (capture/add-entity/add-edge)
are **already built and shipping** against that contract. Two pieces still live on **your** side of
the boundary, and I'd like to add them here, additively:

1. **Stage 0 half — the read contract views** (`007_contract_views.sql` + a `busy_timeout` pragma).
   Small, low-risk, no behavior change to the app.
2. **Stage 3 half — a localhost loopback HTTP server** that exposes two existing services
   (hybrid search, grounded story generation) to PersonalServer, behind a setting. Bigger; needs one
   small refactor of the story generator and a couple of shape decisions (below).

Both are governed by a written contract that lives in the PersonalServer repo:
`../PersonalServer/SCHEMA-CONTRACT.md`. **That file is the boundary.** Neither side changes it alone
— if we need to move a column name or an endpoint shape, we change it there and on both sides
deliberately. The C# half is already coded to it, so its request/response shapes are fixed points
you can build against.

Until this loopback ships, PersonalServer's two AI tools (`retrieve_semantic`, `generate_story`)
return `{"error":"starfolio_not_running"}` by design — nothing breaks, they just degrade.

---

## Ground rules I'll hold myself to in this repo

- **Additive only.** No refactor of existing behavior beyond the one generation extraction called out
  below. Your existing services keep their current signatures and callers.
- **Keep your gates green.** Before I hand anything back I'll run, from `app/`:
  `npm run lint` · `npm run typecheck` · `npm run test:unit`. If any goes red, I fix or revert.
- **I won't touch your in-flight work.** You're on `fix/e2e-onboarding-gate`. I'll do this on its own
  branch off wherever you tell me is safe, and I won't stage files you're editing. Tell me if any of
  the files below are hot.
- **Contract-first.** Every field name / endpoint / file shape below already matches
  `SCHEMA-CONTRACT.md`. Where STARfolio's real service shape differs, the **adapter lives in the
  loopback handler**, not in your services and not in the contract.

---

## Work item 1 — Stage 0 half: read contract views + busy_timeout

**Why:** PersonalServer's read tools query a stable set of `v_*` views, not your raw tables, so your
migrations can refactor underneath without breaking the bridge.

**Files:**
- **NEW** `app/src/main/db/migrations/007_contract_views.sql` — seven `CREATE VIEW v_*` statements.
  The exact DDL is pinned verbatim in `../PersonalServer/SCHEMA-CONTRACT.md` (the "Read contract —
  views" block): `v_experiences`, `v_experience_skills`, `v_experience_tags`, `v_experience_metrics`,
  `v_entities`, `v_edges`, `v_experience_sources`. They're pure views over your existing tables
  (`experiences`, `experience_skills`+`skills`, `experience_tags`+`tags`, `metrics`, `entities`,
  `edges`, `experience_sources`+`sources`) — no schema/table change.
- **EDIT** `app/src/main/db/migrate.ts` — `import sql007 from './migrations/007_contract_views.sql?raw'`
  and add `{ version: 7, sql: sql007 }` to `MIGRATIONS`. Your runner (`runMigrations`) already backs
  up before applying to an existing DB, so this rides your normal path.
- **EDIT** `app/src/main/db/client.ts` — add `db.pragma('busy_timeout = 5000')` next to the existing
  `journal_mode = WAL` / `foreign_keys = ON` pragmas in `initDb()`. This lets the two potential
  writers (app + MCP server) serialize under WAL instead of erroring on a locked file.
- **NEW** `app/tests/unit/contract-views.test.ts` (vitest) — open an in-memory DB, run migrations,
  assert all seven views exist and expose the pledged columns.

**Risk:** low. Views are read-only projections; the pragma is a timeout. No existing query changes.

---

## Work item 2 — Stage 3 half: localhost loopback HTTP server

**Why:** semantic (vector-KNN) retrieval and grounded generation must stay here — they need your
embedding model and your "nothing gets invented" grounding. PersonalServer proxies to a tiny
localhost server you expose while the app runs.

### Shape (from `SCHEMA-CONTRACT.md`, already coded on the C# side)

- Bind a raw Node `http` server to **`127.0.0.1:0`** (ephemeral port), **behind a setting**.
- On start, write `app.getPath('userData')/loopback.json` = `{ "port": <int>, "token": "<secret>" }`.
  PersonalServer reads that file every call (never guesses a port) and authenticates with
  `Authorization: Bearer <token>`. Reject any request whose bearer token ≠ the one you wrote.
- On quit, stop the server and delete `loopback.json`.
- Two endpoints, both `POST`, JSON in/out:

  | Endpoint | Request (what C# sends) | Response (what C# reads) |
  |---|---|---|
  | `/retrieve` | `{ query, limit }` | `{ "results": [ { experience_id, title, score, snippet } ] }` |
  | `/generate` | `{ experience_ids, genre?, jd?, length? }` | `{ "story": "<text>", "experience_ids": [ ... ] }` |

### Proposed files

- **NEW** `app/src/main/loopback/server.ts` — `startLoopbackServer()` / `stopLoopbackServer()`:
  create the http server, generate a random token, write/remove `loopback.json`, route the two paths,
  enforce bearer auth + 127.0.0.1 binding.
- **EDIT** `app/src/main/index.ts` — start it inside `app.whenReady()` after `registerIpcHandlers(...)`
  (only if the setting is on); stop it in the `app.on('will-quit', …)` handler alongside the other
  workers.
- **EDIT** `app/src/main/settings/prefs.ts` — add a `loopbackEnabled` boolean pref (default **off**),
  following the existing `Prefs`/`DEFAULTS`/`KEYS` pattern (`pref.loopback.enabled`, `'1'`/`'0'`).
- **NEW** `app/tests/unit/loopback.test.ts` — start the server on a random port, hit both endpoints
  with the token (stub the two services), assert response shapes; assert 401 without the token.

### The adapter — where your services and the contract don't line up 1:1

This is the crux; please sanity-check it.

**`/retrieve` → `searchExperiences(filter)` (`app/src/main/search.ts`)**
- Call `searchExperiences({ query })`, then take the first `limit` results.
- Map each `ExperienceSummary` → `{ experience_id: s.id, title: s.title, snippet: s.snippet, score }`.
- **Decision R1 — score:** `ExperienceSummary` doesn't currently expose the RRF fusion score. The C#
  side reads `score` but tolerates its absence (defaults to 0), so the minimum is to omit it. Cleaner
  would be to surface the fused RRF score on the summary (or a parallel array) so the client can rank.
  Your call — omit for v1, or expose it?

**`/generate` → story generation (`app/src/main/ai/story.ts`)**
- Today `streamStory(config, sender: WebContents)` **streams** tokens over IPC (`ai:token`/`ai:done`/
  `ai:error`) and needs a renderer `WebContents`. The loopback has no WebContents and needs a single
  response. **Proposed refactor (additive):** extract the core into
  `generateStoryText(config): Promise<{ story: string; experienceIds: string[] }>` that resolves the
  full text; then `streamStory` stays a thin wrapper that streams what the core produces, and the
  loopback awaits the core directly. No behavior change for the renderer path.
- **Request mapping** (contract → your `StoryConfig`):
  - `experience_ids` → `experienceIds`
  - `jd` present → `{ kind: 'jd', promptText: jd }`; else `genre` present → `{ kind: 'genre',
    promptText: genre }`. **Decision G1:** if neither is provided (both optional in the C# tool), do we
    default (e.g. `kind:'genre'`, a neutral prompt) or return a `{error}`? I lean: return an error the
    client can act on.
  - `length` maps `short→short`, `medium→medium`, **`long→detailed`** (your enum is
    `short|medium|detailed`). **Decision G2:** confirm `long`→`detailed` is the right pairing.
  - `tone` defaults `'professional'`; `requestId` generated per call; `notes` omitted.
- **Response:** `{ story: <accumulated text>, experience_ids: config.experienceIds }`. Grounding stays
  entirely yours — PersonalServer relays the story **verbatim** and never re-authors it; it only
  passes provenance through. `NoExperiencesError` (no ids resolved) should surface as a clean error.

---

## One thing to verify together: the userData path

PersonalServer's `Db.cs` resolves the DB at **`%APPDATA%\STARfolio\superstar.db`** (Roaming) by
default, and will look for `loopback.json` in that same folder. Electron's `app.getPath('userData')`
is Roaming `AppData\<productName>` by default — so if your `productName` is `STARfolio` and you
haven't overridden `userData`, we line up. **Please confirm** the real folder (Roaming vs Local). If
it differs, we either align the default or set PersonalServer's `SUPERSTAR_DB_PATH` /
`SUPERSTAR_LOOPBACK_FILE` env overrides (both already supported) in the Claude Desktop config.

---

## What I need from you before I cook

1. **Green light on the branch/placement** — off `fix/e2e-onboarding-gate`, or a fresh branch off your
   mainline? And are any of these files (`index.ts`, `prefs.ts`, `client.ts`, `migrate.ts`,
   `ai/story.ts`, `search.ts`) actively being edited right now?
2. **Decisions R1, G1, G2** above (score exposure; no-prompt behavior; `long`↔`detailed`).
3. **The `generateStoryText` extraction** — OK to refactor `streamStory` into a thin wrapper over an
   awaitable core? If you'd rather I not touch `story.ts`, the alternative is a collector "fake
   sender" in the loopback that accumulates `ai:token` events — uglier but zero change to your file.

I'll split the work into two PRs (views/pragma first, loopback second), each additive and each with
your gates green. Ping me with answers (or edits to this doc) and I'll start.

---

## Answers from STARfolio — go ahead

1. **Branch/placement:** fresh branch off `main` (mainline), not off my in-flight work. Two PRs as
   you proposed. Note: I'm actually on `stage/11-maintain` right now, not `fix/e2e-onboarding-gate`.
   Of your file list, only **`prefs.ts` is hot** (a settings reorg just added a `voiceModel` pref);
   it goes cold once that commit lands. `index.ts`, `client.ts`, `migrate.ts`, `ai/story.ts`,
   `search.ts` are all cold — clear to edit.
2. **R1 (retrieve score):** omit for v1. `searchExperiences` already returns results in rank order;
   the client relays that order and defaults `score` to 0. Don't touch `search.ts` output shape yet.
3. **G1 (no jd + no genre on /generate):** return a clean `{error}` the client can act on. No silent
   neutral-prompt fallback — keeps grounding honest.
4. **G2 (`long`→`detailed`):** confirmed. My enum is `short|medium|detailed`; `detailed` is the
   longest tier, so `long`→`detailed` is right.
5. **`generateStoryText` extraction:** approved. Extract the awaitable core
   `generateStoryText(config): Promise<{ story, experienceIds }>`; `streamStory(config, sender)` stays
   a thin wrapper that streams what the core produces. Renderer path unchanged.
6. **userData path:** confirmed lined up. `productName` is `STARfolio`, no `userData` override, so
   Electron resolves Roaming `%APPDATA%\STARfolio\` — same folder your `Db.cs` uses for `superstar.db`
   and where `loopback.json` will live. No env override needed.

---

## Done — branches to push (over to you)

Both work items are **built and all three gates are green** (`eslint` · `typecheck` node+web ·
`vitest run` — full suite 124 passed / 1 skipped / 0 failed, including the new tests). Every one of
your answers above is honored as written. I did **not** push anything or open PRs — that's yours.

I temporarily rebuilt `better-sqlite3` for Node to run vitest, then ran `rebuild:electron` to put it
back to the Electron ABI. Your workspace (uncommitted voice-model work + staged `VoiceModelManager`
rename) is exactly as you left it; `HEAD` is back on `stage/11-maintain`.

**Two local branches, each = `stage/11-maintain` HEAD + one self-contained commit:**

| Branch | Commit | Contents |
|---|---|---|
| `bridge/contract-views` | `4f1a2c0` `feat(db): add v_* contract views + busy_timeout pragma` | `007_contract_views.sql`, `migrate.ts` (v7), `client.ts` (`busy_timeout=5000`), `tests/unit/contract-views.test.ts` |
| `bridge/loopback-server` | `a5a2356` `feat(loopback): add localhost bridge for retrieve + grounded story` | `loopback/server.ts` (new), `ai/client.ts` (`runToCompletion`), `ai/story.ts` (`generateStoryText`; `streamStory` unchanged), `index.ts` (start/stop wiring), `tests/unit/loopback.test.ts` |

**⚠ Branch base — one thing to decide (you own the merge flow):** you asked for "off `main`," but
`stage/11-maintain` is **11 commits ahead of `origin/main`**, and the loopback commit's `index.ts`
edit layers on top of stage-11's `index.ts` (updater/nudges/tray — not on `main`). So I based both on
`stage/11-maintain` HEAD. Your two clean options:
- **PR against `stage/11-maintain`** → each PR shows exactly my one commit. Simplest.
- **After stage-11 lands on `main`**, cherry-pick `4f1a2c0` then `a5a2356` onto `main` — they apply
  clean there (only `index.ts` needs stage-11's context). The two commits are independent of each
  other and touch files disjoint from your voice-model work.

**Still deferred (as agreed):** the loopback is gated by `loopbackEnabled()`, currently an env gate
`STARFOLIO_LOOPBACK=1` (**default off**). Swap it to a real `prefs.ts` pref (`pref.loopback.enabled`,
alongside `voiceModel`) once your settings reorg commits — I left it out to keep off your hot
`prefs.ts`. That's the only follow-up.

**Two small adaptations worth knowing:**
- `/retrieve` wraps your **hybrid** `searchExperiences` (FTS ∪ vector RRF), a superset of pure
  semantic; it degrades to FTS-only when the embed model isn't ready. Maps `{id,title,snippet}` →
  `{experience_id,title,snippet}`, `score` omitted (results stay in rank order).
- The loopback writer honors `SUPERSTAR_LOOPBACK_FILE` (same env var PersonalServer reads) — used by
  the unit test, and a ready escape hatch if the userData path ever needs overriding.
