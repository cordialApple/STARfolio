# STARfolio

A private, single-user desktop app: a longitudinal bank of accomplishments in STAR form
(Situation / Task / Action / Result), with an LLM assistant that runs live mock interviews
with feedback and generates polished, provenance-linked STAR stories on demand.

Local-first, no account, no server. Windows-first (cross-platform capable). Your Anthropic
API key is stored in the OS credential store and never leaves your machine except to call
the Anthropic API directly.

- **Concept & user stories:** [docs/starfolio-concept.md](docs/starfolio-concept.md)
- **Architecture spec:** [docs/architecture.md](docs/architecture.md)
- **Build plan (staged):** [docs/build-plan.md](docs/build-plan.md)

## Install

Download the latest `STARfolio-<version>-setup.exe` from the
[Releases](https://github.com/cordialApple/STARfolio/releases) page and run it. The default
install is per-user and needs no admin rights.

Windows may show a SmartScreen warning ("Windows protected your PC") because this app isn't
code-signed. Click **More info** then **Run anyway** to install. This shows on the initial
installer download and won't recur for auto-updates once the app trusts itself as
already-installed.

Once installed, STARfolio checks GitHub Releases for updates: open **Settings → Updates**,
click **Check for updates**, then download and restart to install. If the in-app updater
ever fails, the accepted fallback is to download the newer installer from the Releases page
and run it over the existing install.

## Stack

Electron + React + TypeScript + Tailwind, SQLite (`better-sqlite3`) with FTS5 keyword search
and `sqlite-vec` vector KNN, `transformers.js` embeddings and `smart-whisper` speech-to-text
running in worker processes, and the Anthropic SDK in the main process. Packaged with
electron-builder (NSIS).

## Develop

All commands run from `app/`:

```bash
npm install          # install deps
npm run dev          # run the app with hot reload
npm run lint         # eslint (gating in CI)
npm run typecheck    # tsc, main + renderer
npm run test:unit    # vitest (services, temp-file SQLite) — runs under Node ABI
npm run build:unpack # rebuild native for Electron ABI, then package unpacked
npm run test:e2e     # build:unpack + Playwright smoke against the packaged app
npm run test:e2e:dev # dev fallback: build + Playwright against the Electron-run build
```

Native modules (`better-sqlite3`) are ABI-specific: unit tests run under Node's ABI, while
the packaged app and e2e run under Electron's ABI. `npm run rebuild:electron` (invoked by
`build:unpack`) rebuilds them for Electron; a plain `npm install`/`npm rebuild` resets them
to Node's ABI for unit tests. This is why CI runs unit tests **before** `build:unpack`.

> On Windows, `build:unpack` may fail locally extracting electron-builder's `winCodeSign`
> tool if Developer Mode is off (it can't create the archive's symlinks). This is a local
> privilege limitation only — CI on `windows-latest` packages fine. Use `test:e2e:dev`
> locally to exercise the same code paths under Electron without full packaging.

## Release (tag → GitHub Release)

Releases are cut by pushing a `v*` tag. The [`release.yml`](.github/workflows/release.yml)
workflow runs on `windows-latest`, derives the app version from the tag, packages the NSIS
installer, and publishes a GitHub Release with the installer, its `.blockmap`, and
`latest.yml` (the electron-updater feed) attached.

```bash
# bump the version, commit, then tag and push
git tag v0.1.0
git push origin v0.1.0
```

The workflow creates a **draft** GitHub Release with the assets; review and **publish** it
from the GitHub Releases page. Publishing is required: electron-updater cannot see draft
releases, so an unpublished release looks identical to "no update available" to installed
clients. Once published, installed apps pick it up via **Settings → Updates** (the app reads
`latest.yml`, downloads the installer over the unsigned-update path, and installs on restart).
