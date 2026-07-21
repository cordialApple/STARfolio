# PersonalServer config handshake — STARfolio writes PersonalServer's backend choice

**Audience:** the agent working in STARfolio (`SuperSTAR`).
**Author:** the agent building `PersonalServer` (the C#/.NET stdio MCP server in `../PersonalServer`).
**Status:** PersonalServer side half-built. The `IExperienceStore` seam shipped (PersonalServer PR #14,
"Stage D1"). PersonalServer's config *reader* + `SqliteStore` revival ("Stage D2") is queued behind this
doc — it was parked precisely because STARfolio had no way to tell PersonalServer which store the user
picked. This doc is the work order that unparks it.

---

## TL;DR

STARfolio already owns the storage choice: `storageMode: 'sqlite' | 'obsidian'` plus `vaultPath`
(`app/src/main/settings/prefs.ts`). PersonalServer now selects its backend from its **own** config file
and will honor whatever STARfolio puts there. The missing piece is entirely on your side: **write
PersonalServer's config file to reflect the user's storage choice — once at onboarding, and again on any
change to `storageMode` or `vaultPath`.** Fire-and-forget: you write a small JSON file, you never read
anything back, you never launch or talk to PersonalServer.

That's the whole task. One config writer + two call sites (onboarding-done, settings-change) + a mapping
table + tests.

---

## Why this, and why now

- PersonalServer used to bridge only `superstar.db`. It pivoted to a vault-native surface, then (Stage
  D1) grew an `IExperienceStore` seam so one server can serve **either** a markdown vault **or**
  `superstar.db`, chosen at runtime.
- The build-plan rule on the PersonalServer side is: **PersonalServer reads its own config; STARfolio is
  the UX source of truth for the choice and pushes it down. PersonalServer never reaches into STARfolio.**
  So the direction of the write is STARfolio → PersonalServer's config, never the reverse.
- Today nothing writes it (confirmed: a full search of `app/` for any PersonalServer config path finds
  zero writes). Until you add the writer, PersonalServer cannot follow the user's Obsidian-vs-SQLite
  choice automatically.

---

## The boundary: PersonalServer's config file

This file **is** the contract. Neither side changes its shape unilaterally — if a field must move, we
change it here and on both sides deliberately. PersonalServer's Stage D2 reader is coded to exactly this.

### Location (per-OS)

PersonalServer resolves its config directory the same way it resolves its publish location:

| OS | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\PersonalServer\config.json` |
| macOS | `~/Library/Application Support/PersonalServer/config.json` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/PersonalServer/config.json` |

On Windows that is `path.join(app.getPath('localAppData'), 'PersonalServer', 'config.json')`. Note this is
`localAppData` (Local), **not** `%APPDATA%` (Roaming) where `superstar.db` lives. Create the parent
directory if absent.

### Schema (v1)

```json
{
  "version": 1,
  "backend": "vault",
  "vaultPath": "C:\\Users\\me\\Documents\\Design_Exp",
  "dbPath": "C:\\Users\\me\\AppData\\Roaming\\STARfolio\\superstar.db",
  "source": "starfolio",
  "updatedUtc": "2026-07-21T12:00:00Z"
}
```

| Field | Type | Meaning |
|---|---|---|
| `version` | `1` | Schema version. Bump only by changing this doc. |
| `backend` | `"vault" \| "sqlite"` | Which store PersonalServer treats as authoritative. |
| `vaultPath` | abs path \| `null` | The markdown vault dir. Set when `backend:"vault"`. |
| `dbPath` | abs path \| `null` | The `superstar.db` file. Always include it if known, even in vault mode (reference/fallback). |
| `source` | `"starfolio"` | Who wrote the file. Lets PersonalServer distinguish a STARfolio-managed config from a hand-edited one. |
| `updatedUtc` | ISO-8601 UTC | When you last wrote it. |

---

## The mapping (STARfolio prefs → PersonalServer config)

`getExperienceStore()` in `app/src/main/store/experience-store.ts` already encodes the real rule: SQLite
is always primary; Obsidian mode adds a **write-through markdown mirror** at `vaultPath`. So:

| STARfolio state | PersonalServer `backend` | `vaultPath` | `dbPath` |
|---|---|---|---|
| `storageMode:'obsidian'` **and** `vaultPath` set | `"vault"` | the `vaultPath` | the `superstar.db` path |
| `storageMode:'sqlite'` | `"sqlite"` | `null` | the `superstar.db` path |
| `storageMode:'obsidian'` but `vaultPath` **null** | `"sqlite"` | `null` | the `superstar.db` path |

That last row mirrors the silent fallback you already have (`experience-store.ts:75` returns
`sqliteExperienceStore` when `vaultPath` is null) — keep the two in agreement.

`dbPath` = the resolved `superstar.db`, i.e. `path.join(app.getPath('userData'), 'superstar.db')`.

### Source-of-truth note (read this before you build)

In Obsidian mode STARfolio still treats **SQLite as authoritative** and the vault as a derived mirror.
PersonalServer in `backend:"vault"` will read *and write* that same markdown vault directly. A note
PersonalServer writes to the vault is invisible to STARfolio's SQLite until the user runs `vault:sync`
(`runVaultSync` → `reconcileVault`). Your existing reconcile already handles this: `planReconcile` merges
by experience `id` (last-writer-wins on `updated_at`) and imports id-bearing notes with no SQLite row as
new rows. So the loop closes on next sync **provided PersonalServer writes stable `id` frontmatter** —
which it does. No new reconcile work is required for this task; just be aware the two writers converge at
sync time, not instantly. If you decide you'd rather PersonalServer never write markdown independently,
that's a separate follow-up (e.g. auto-reconcile on a timer); it is out of scope here.

### Vault markdown parity (informational — no action for you)

PersonalServer writes the same one-file-per-experience markdown you do. For the record, PersonalServer's
frontmatter is `id, title, context, status, confidence{situation,task,action,result}, skills[{name,kind}],
tags[], metrics[{label,value,unit}], entities[]` with `## Situation/Task/Action/Result/Gaps` sections.
Yours (`app/src/main/vault/markdown.ts`) uses `id, title, context, status, happened_*, created_at,
updated_at, skills["Name (kind)"], tags` with `## Situation/Task/Action/Result/Metrics`. These are **not
identical** today. Full round-trip parity between the two writers is a real (separate) effort and is **not**
part of this handshake — this doc only asks you to write the config file. Flagging it so nobody assumes
Obsidian mode gives byte-identical notes from both sides yet. If/when you want true co-editing, that gets
its own contract.

---

## When to write it

Write PersonalServer's config on each of these:

1. **Onboarding completion** — after the user picks storage in `Onboarding.tsx` and `onboardingDone`
   flips true. This is the first time the choice exists.
2. **Any settings change** to `storageMode` or `vaultPath` — hook `setPrefs` in
   `app/src/main/settings/prefs.ts` (or the `vault:choose` handler in `ipc/bank.ts` that sets
   `vaultPath`). Rewrite whenever either value changes.
3. **App startup (self-heal)** — write once on `app.whenReady` so a deleted/stale file is regenerated and
   a `superstar.db` that moved gets a fresh path. Cheap, idempotent, saves a support headache.

---

## Write discipline

- **Atomic:** write to `config.json.tmp` in the same dir, then `rename` over `config.json`. Never leave a
  half-written file — PersonalServer may read it at any instant.
- **Create the parent dir** (`mkdir -p` equivalent) before writing.
- **Preserve unknown keys:** if `config.json` already exists and parses, read it, overwrite only the keys
  in the schema above, and keep any other keys intact. PersonalServer may grow config it owns; don't
  clobber it.
- **Permissions:** `0o600` on POSIX (matches how you already write `loopback.json`). No-op on Windows.
- **Never throw into the UI:** a config-write failure is best-effort telemetry, not a user-blocking error.
  Log and move on — PersonalServer falls back to its own defaults (vault at `~/Documents/Design_Exp`) if
  the file is missing.

---

## What PersonalServer does with it (so you know the other half is real)

PersonalServer's Stage D2 reader resolves the backend in this precedence (highest wins):

1. Env vars — `EXPERIENCE_BACKEND` (`vault`|`sqlite`), `EXPERIENCE_VAULT`, `SUPERSTAR_DB_PATH` — for power
   users who set them in the Claude Desktop MCP config.
2. This `config.json` (`backend` / `vaultPath` / `dbPath`).
3. Built-in default: `backend:"vault"`, vault at `~/Documents/Design_Exp`.

So your write is the default the user never has to think about; an explicit env var can still override it.
`backend:"sqlite"` selects PersonalServer's revived `SqliteStore`, which reads `superstar.db` through the
**`v_*` contract views** you still ship (`007_contract_views.sql`) — that half of the contract is
unchanged and already verified by your `contract-views.test.ts`.

---

## Acceptance criteria

1. After onboarding with **Obsidian** + a chosen vault dir, `config.json` exists at the OS path above with
   `backend:"vault"`, `vaultPath` = the chosen dir, `dbPath` = the resolved `superstar.db`, `version:1`,
   `source:"starfolio"`, and a valid `updatedUtc`.
2. Switching to **SQLite** in settings rewrites it to `backend:"sqlite"`, `vaultPath:null`, `dbPath` set.
3. Switching back to Obsidian rewrites it to `backend:"vault"` with the vault path.
4. `storageMode:'obsidian'` with a null `vaultPath` writes `backend:"sqlite"` (matches the store fallback).
5. The write is atomic (no observer ever reads a partial file) and creates the parent dir if missing.
6. Pre-existing unknown keys in `config.json` survive a rewrite.
7. A unit test asserts the mapping table (all four rows) against the writer's pure mapping function.
8. Deleting `config.json` and relaunching regenerates it (startup self-heal).

---

## Non-goals

- STARfolio does **not** launch, spawn, ping, or read back from PersonalServer. One-way config write only.
- No change to `storageMode` semantics, the vault mirror, reconcile, or the loopback server.
- No markdown-schema unification between the two writers (separate future contract, noted above).
- No new `v_*` views — the SQLite read contract is unchanged.

---

## How this slots into your loop

Suggested tracking (yours to schedule — I'm not editing your `build-plan.md`):

- **Build-plan row:** `| 12 | PersonalServer config handshake | write PersonalServer's config.json from storageMode/vaultPath on onboarding + settings change + startup | S | ☐ |`
- **Issue title:** `feat: write PersonalServer backend config on storage-choice change`
- **Touch points:** `app/src/main/settings/prefs.ts` (setPrefs hook), `app/src/main/ipc/bank.ts`
  (`vault:choose`), `app/src/renderer/.../onboarding/Onboarding.tsx` (completion), `app/src/main/index.ts`
  (`app.whenReady` self-heal). New module e.g. `app/src/main/integration/personalserver-config.ts` with a
  pure `mapPrefsToConfig(prefs)` + an atomic `writePersonalServerConfig()`.
- **Estimated size:** S. One small module, three call sites, one mapping test.

When it's built and merged, PersonalServer unparks Stage D2 (revive `SqliteStore` + wire the config
reader) and the two stores become selectable end-to-end by the user's choice in this app.
