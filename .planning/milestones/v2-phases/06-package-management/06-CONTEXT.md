# Phase 6: Package Management - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate dependency *installation* from npm to `bun install` with a committed `bun.lock`, give the install/dev/build/start scripts Bun equivalents while preserving a one-command Node fallback, and confirm the client Vite build still produces a working bundle when run through Bun.

**In scope:** `bun install` adoption + `bun.lock`, Bun script variants with Node fallbacks, Vite-build-through-Bun verification.
**Out of scope:** swapping the bundler (Vite is retained — PKG-03), any server *runtime* changes (done in Phase 5), Docker/CI changes (Phase 7).

Prior de-risking: Phase 4 empirically proved the full dependency tree — including the `@rdkit/rdkit` wasm package and `xlsx` — installs and runs under Bun on arm64. So this phase is mechanical, not a compatibility gamble.
</domain>

<decisions>
## Implementation Decisions

### Lockfile strategy
- **D-01:** Keep BOTH lockfiles. `bun.lock` is committed as the default install artifact; the existing `package-lock.json` files are RETAINED so the Node fallback is an exact, reproducible `npm ci` (satisfies RUN-04's one-command rollback). Accepted cost: two lockfiles per package root that must be regenerated together when dependencies change.
- **D-02:** When deps change, regenerate both lockfiles in the same change (run `bun install` AND `npm install`/`npm ci`) so they don't drift. The planner should document this maintenance rule wherever the install scripts live.

### Migration scope
- **D-03:** Adopt `bun install` across **root + client + server** — all three package roots. This deliberately extends the roadmap's literal "root and client" wording (PKG-01): the server already runs on Bun (Phase 5), so its deps should install the same way for a coherent, single-toolchain migration. Treat server inclusion as a locked scope decision, not creep.

### Script convention
- **D-04:** Mirror Phase 5's runtime convention exactly: `install:all`, `dev`, `build`, and `start` invoke **Bun by default**, with retained `:node` fallback aliases (e.g., `install:all:node`, `build:node`). npm remains available as the explicit fallback path; the default commands switch to Bun. This keeps the script vocabulary consistent with the `:bun`/`:node` aliases shipped in Phase 5.

### Claude's Discretion
- Exact `bun install` flags (e.g., `--frozen-lockfile` in non-interactive contexts) — planner/executor decide.
- **Root dep wrinkle (flagged, not locked):** the root `package.json` currently has ZERO dependencies/devDependencies and no `workspaces`; the `dev` script reaches into `client/node_modules/.bin/concurrently`. So a root `bun install` per PKG-01 is near-trivial today (empty/near-empty root `bun.lock`). Planner decides between: (a) accept the near-empty root lockfile, or (b) promote `concurrently` to a real root `devDependency` so root install is meaningful and `dev` stops borrowing from `client/node_modules`. Option (b) is cleaner but slightly enlarges root scope — planner's call.
- Whether to introduce npm `workspaces`/bun workspaces vs keeping the current per-package install model (`install:all` looping client + server). Default expectation: keep the per-package model unless the planner finds workspaces materially simpler.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — PKG-01, PKG-02, PKG-03 (and RUN-04 fallback constraint that D-01 satisfies).
- `.planning/ROADMAP.md` §"Phase 6: Package Management" — goal + success criteria.

### Prior-phase precedent (the convention this phase mirrors)
- `.planning/phases/05-server-runtime-on-bun/05-CONTEXT.md` — Phase 5 `:bun`/`:node` default+fallback convention that D-04 extends.
- `.planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md` — measurement methodology (relevant if Phase 6 re-measures; not required).
- `.planning/phases/04-compatibility-spike-baseline/` — empirical proof that deps install/run under Bun on arm64 (the de-risk for PKG-01/PKG-03).

### Codebase maps
- `.planning/codebase/STACK.md`, `.planning/codebase/STRUCTURE.md` — monorepo layout (root + client + server).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 5's `:bun`/`:node` alias pattern in `package.json` + `server/package.json` is the direct template for the install/build/dev variants.
- `spike/runtime-env-check.mjs` (Phase 5) already probes `bun`/`node`/`npm` availability — reusable to gate `bun install` steps.

### Established Patterns
- Monorepo with independent `package.json` per root: root (dep-less today), `client/` (Vite/React), `server/` (Express, now Bun runtime). `install:all` = `npm --prefix client install && npm --prefix server install`.
- `build` = `npm --prefix client run build` (Vite). `start` = `npm run build && npm --prefix server run start:unified` (server already on Bun).
- Current lockfiles: `client/package-lock.json` and `server/package-lock.json` exist; **no root `package-lock.json`** (root has no deps); no `bun.lock` anywhere yet.

### Integration Points
- `dev` script depends on `concurrently` resolved from `client/node_modules/.bin/` — verify it still resolves after `bun install` (bun populates `.bin`), or address via the root-devDep wrinkle above.
- Vite build invoked through Bun (PKG-03) — the `build:node` npm path must remain as the fallback.
</code_context>

<specifics>
## Specific Ideas

Keep the migration faithful to Phase 5's shape: Bun is the default, Node is one command away. No new tooling beyond `bun install`; Vite stays the bundler.
</specifics>

<deferred>
## Deferred Ideas

- Bun-native bundler / replacing Vite — explicitly out of scope (PKG-03 retains Vite); not a future phase unless re-roadmapped.
- Docker `oven/bun` image + Bun-powered CI + bun test/check scripts — Phase 7.

None of the above were folded into Phase 6.
</deferred>

---

*Phase: 6-Package Management*
*Context gathered: 2026-06-05*
