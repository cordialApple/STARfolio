# Architecture — Anthropic Auth

Part of the [architecture spec](../architecture.md)

## Current state

The user pastes a Console API key (`sk-ant-…`) in Settings. It's stored via Electron `safeStorage` (DPAPI on Windows) in the settings table (`settings/secrets.ts`), read only in the main process, and passed explicitly to `new Anthropic({ apiKey })` in `ai/transport.ts` and `ai/extract.ts`. The key never enters the renderer and never leaves the machine except to the Anthropic API.

## Decision

**Console API key stays the primary credential.** It matches the locked "no account, no server" constraint, has stable terms, and keeps the privacy story intact.

**Planned addition — SDK credential fallback**: when no key is stored, construct a bare `new Anthropic()` and let the SDK resolve `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → a local OAuth profile from `ant auth login`. This gives developers and key-averse users a no-paste path with short-lived tokens; the credential still lives only on the user's machine. Settings shows which source is active. A stored key always wins, so existing users see no change.

## Rejected alternatives (July 2026 reality)

- **Claude.ai subscription OAuth (Pro/Max)** — using consumer OAuth tokens in any third-party product violates Anthropic's Consumer ToS (clarified Feb 2026, enforced from Jan 2026). Do not lift a Claude Code/claude.ai token into `ANTHROPIC_AUTH_TOKEN`.
- **Claude Agent SDK subscription mode** — third-party apps built on the Agent SDK *are* currently permitted to draw on a user's subscription, but the policy whipsawed four times Jan–Jun 2026 (block → cutoff → credit plan → pause) and the Agent SDK is a heavyweight runtime that replaces our thin `messages.stream`/`messages.parse` transport. Parked; the `AiTransport` seam is where it would slot in if the policy stabilizes.
- **Admin API key provisioning** — org-shaped (requires an admin key and an organization behind the users). Wrong shape for a single-user consumer app.
- **Backend proxy** — a server holding the real credential would break the core posture: data and credential would flow through our infrastructure, requiring accounts, billing, and abuse controls. Contradicts the locked "no account, no server" decision.

## Caveats

- `ant auth login` profiles are documented by Anthropic as intended for interactive development on your own machine; for STARfolio each user does run it interactively on their own machine, but it bills a Console account either way — it removes key-pasting, not the Console signup.
- OAuth refresh tokens hard-expire, so profile users will periodically re-run `ant auth login`; surface the SDK's auth error with that hint.
