# Changelog

## v2 — Bun Migration (in progress)

### Phase 6 — Package Management

- Dependencies now install via **`bun install`** at the root, `client/`, and `server/`;
  `bun.lock` is committed for all three roots (`bun install --frozen-lockfile` passes in each).
- `install:all`, `dev`, `build`, and `start` invoke Bun by default; **npm/Node fallbacks**
  are retained via `:node`-suffixed scripts (`install:all:node`, `dev:node`, `build:node`, `start:node`).
- Both lockfile families (`bun.lock` + `package-lock.json`) are kept in sync; run
  `bun run lockfiles:refresh` and commit both when dependencies change.
- **Vite remains the client bundler** — `bun run build` invokes `vite build` through Bun's
  package runner and produces a working `client/dist` bundle (bundler swap is out of scope, deferred to BNDL-01).
- Docker, CI, and `check`/`test` script migration are intentionally deferred to Phase 7.

---

🤖 Phase 6 executed with [Claude Code](https://claude.com/claude-code) (Opus 4.8, 1M context).

### Phase 5 — Server Runtime on Bun

- Express API now runs on the **Bun** runtime by default in dev and production
  (`bun index.js` / `bun --watch index.js`), with npm retained as the script runner.
- Stripe webhook migrated to `constructEventAsync` for Bun WebCrypto compatibility
  (behavior-identical to the sync path; valid/forged signature handling unchanged).
- Runtime parity smoke tests pass 13/13 under both Node and Bun; `bun --watch` reload verified.
- One-command **Node rollback** aliases preserved at server and root level (`*:node`).
- RSS/startup measured on oracle Linux (N=5, `/proc` VmRSS): Bun idle RSS 115.1 MiB vs the
  locked 118.9 MiB Phase 4 baseline → gate **PASS**, Bun stays default. On the same host Node
  measured 115.5 MiB — Bun is at parity with Node, not a memory win. See
  `.planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md`.

---

🤖 Phase 5 executed with [Claude Code](https://claude.com/claude-code) (Opus 4.8, 1M context).
