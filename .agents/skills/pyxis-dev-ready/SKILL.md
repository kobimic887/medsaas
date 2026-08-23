---
name: pyxis-dev-ready
description: Confirm Pyxis coding box is ready (bun on PATH, dual lockfiles, no local mongo start). Use at session start on 151/T3 or when bun/npm commands fail.
disable-model-invocation: true
---

# Pyxis dev-ready

User-only. Run when a box cannot `bun run`, lockfiles look split, or an agent wants to start local Mongo.

## Measure

```bash
command -v bun || true
"$HOME/.bun/bin/bun" --version
```

- **Mac:** `~/.bun/bin` is already on PATH.
- **151 / T3:** binary lives at `~/.bun/bin/bun`. Non-interactive bash only sees it if `~/.bun/bin` is exported **above** the `~/.bashrc` interactive-only `return`, and/or in `~/.profile`. Do not rewrite the T3 marker in `~/.codex/AGENTS.md`.

If `command -v bun` is empty, use `"$HOME/.bun/bin/bun"` for this session. Then put this **above** the bashrc `case $-` return (and in `~/.profile`):

```bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
```

## Runtime

- Package scripts are **bun-first** (`dev`, `check`, `lint`, `ci`). Prefer `bun run …`, not a Node-only rewrite.
- Root, `client/`, and `server/` keep **both** Bun and npm lockfiles. After a dependency change: `bun run lockfiles:refresh` and commit **both** families.
- `bun run lint` is Biome **lint only**. Formatter is off. Do not `biome format --write` or `lint:fix` unless asked.

## Never start local Mongo

Prod application data is **MongoDB Atlas**. Do not `docker compose up mongo`, `bun run services:up`, or otherwise start a local Mongo to “make the app work.”

Leftover 151 mongo volume is not the app database. Do not treat it as source of truth.

## Smallest check

```bash
bun run lint          # or "$HOME/.bun/bin/bun" run lint
bun run check         # server compile + client build when both sides moved
```

A green build alone does not prove a dashboard flow. See `pyxis-feature-slice`.
