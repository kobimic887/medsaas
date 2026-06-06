# Phase 6: Package Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-05
**Phase:** 6-Package Management
**Areas discussed:** Lockfile strategy, Migration scope, Script convention

---

## Lockfile strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Keep both | Commit bun.lock as default + retain package-lock.json for exact Node-fallback (`npm ci`) reproducibility. Two lockfiles to keep in sync. | ✓ |
| bun.lock only | Remove package-lock.json; single source of truth. Node fallback degrades to `npm install` (non-reproducible). | |

**User's choice:** Keep both
**Notes:** Preserves RUN-04's one-command, reproducible Node rollback. Accepted maintenance cost: regenerate both lockfiles together when deps change (captured as D-02).

---

## Migration scope

| Option | Description | Selected |
|--------|-------------|----------|
| Root + client + server | Unify all three roots on bun install; server runtime already Bun (Phase 5). Slightly exceeds roadmap's literal "root and client". | ✓ |
| Root + client only | Roadmap literal; server deps stay on npm install (mixed toolchain). | |

**User's choice:** Root + client + server
**Notes:** Deliberate, locked extension of PKG-01 wording for a coherent single-toolchain migration. Not treated as scope creep.

---

## Script convention

| Option | Description | Selected |
|--------|-------------|----------|
| Bun default + :node fallback | install:all/dev/build/start invoke Bun by default; retained :node fallback aliases. Mirrors Phase 5. | ✓ |
| Explicit :bun, keep npm default | Add :bun variants but leave defaults on npm. More conservative, inconsistent with Phase 5. | |

**User's choice:** Bun default + :node fallback
**Notes:** Keeps the script vocabulary consistent with the Phase 5 `:bun`/`:node` runtime aliases.

## Claude's Discretion

- Exact `bun install` flags (e.g., `--frozen-lockfile` in CI-like contexts).
- Root dep wrinkle: root has zero deps and borrows `concurrently` from client/node_modules — planner chooses whether to accept a near-empty root lockfile or promote `concurrently` to a root devDependency.
- Per-package install model vs introducing workspaces.

## Deferred Ideas

- Replacing Vite with a Bun-native bundler — out of scope (PKG-03 retains Vite).
- `oven/bun` Docker image, Bun-powered CI, bun test/check scripts — Phase 7.
