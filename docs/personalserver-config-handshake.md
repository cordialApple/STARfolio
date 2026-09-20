# PersonalServer config handshake

Status: STARfolio side built. External reader compatibility and markdown-schema parity remain.

## Boundary

STARfolio owns the user's storage choice. PersonalServer owns its runtime and reads its own config.
STARfolio writes that config in one direction; it never launches, queries, or manages PersonalServer.

The writer maps:

| STARfolio state | PersonalServer backend | `vaultPath` | `dbPath` |
|---|---|---|---|
| SQLite | `sqlite` | `null` | local `superstar.db` |
| Obsidian | `vault` | selected vault | local `superstar.db` fallback |

The managed fields are `version`, `backend`, `vaultPath`, `dbPath`, `source`, and `updatedUtc`. Unknown
PersonalServer-owned keys are preserved.

## Location

| Platform | Config path |
|---|---|
| Windows | `%LOCALAPPDATA%\PersonalServer\config.json` |
| macOS | `~/Library/Application Support/PersonalServer/config.json` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/PersonalServer/config.json` |

`PERSONALSERVER_CONFIG_FILE` may override the path for tests or custom deployments.

## Shipped behavior

- `mapPrefsToConfig` produces the shared shape.
- The writer creates the parent directory, writes a temporary file, and renames atomically.
- Startup self-heals missing or stale config.
- Storage-mode and vault-path changes trigger a sync.
- Write failure logs a warning and does not block STARfolio startup or settings changes.
- Unit tests cover mapping, key preservation, atomic replacement, and path resolution.

## Remaining direction

Confirm the PersonalServer reader accepts the shipped shape and precedence rules. Then reconcile the
markdown schema and automatic refresh behavior so PersonalServer-authored vault entries appear in
STARfolio without manual ambiguity. This is cross-repository contract work, not another STARfolio
writer implementation.
