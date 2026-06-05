---
phase: 06-package-management
verified: 2026-06-05T07:33:04Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
deferred:
  - truth: "Docker, CI, check, and test script migration under Bun"
    addressed_in: "Phase 7"
    evidence: "ROADMAP Phase 7 success criteria cover oven/bun Docker, GitHub Actions, and check/test scripts; README.md and CLAUDE.md explicitly keep this out of Phase 6."
---

# Phase 6: Package Management Verification Report

**Phase Goal:** All dependencies install via bun install, bun.lock is committed, and every developer-facing script has a Bun equivalent with a Node fallback path preserved.
**Verified:** 2026-06-05T07:33:04Z
**Status:** passed
**Re-verification:** No - initial verification

Note: `gsd-tools` is not available on PATH in this environment, so artifact, key-link, and requirement verification was performed manually against the codebase.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `bun install` works at root, `client/`, and `server/`; Bun lockfiles are committed for all three roots. | VERIFIED | `bun install --frozen-lockfile` passed in all three roots. `git ls-files` includes `bun.lock`, `client/bun.lock`, and `server/bun.lock`. |
| 2 | npm fallback lockfiles are retained for root, client, and server. | VERIFIED | `git ls-files` includes `package-lock.json`, `client/package-lock.json`, and `server/package-lock.json`; all are lockfileVersion 3. |
| 3 | `install:all`, `dev`, `build`, and `start` invoke Bun behavior by default. | VERIFIED | `package.json` scripts call `bun install`, `bun --cwd=client`, `bun --cwd=server`, and `bun run build:bun`. Script assertion passed. |
| 4 | Node/npm fallback paths are preserved for install/dev/build/start. | VERIFIED | `install:all:node`, `dev:node`, `build:node`, and `start:node` exist and use `npm ci`, `npm --prefix`, and server `*:node` scripts. `npm run build:node` passed. |
| 5 | Dual-lockfile maintenance rule is executable and documented. | VERIFIED | `package.json` has `lockfiles:refresh` with Bun installs and npm `--package-lock-only`; README.md and CLAUDE.md require committing both lockfile families together. |
| 6 | D-03 package roots are covered: root, client, and server. | VERIFIED | Root `install:all` and `lockfiles:refresh` include root, `bun --cwd=client`, and `bun --cwd=server`; docs list all three lockfile roots. |
| 7 | Bun-invoked client build retains Vite and produces `client/dist`. | VERIFIED | `bun run build` passed and output shows `bun --cwd=client run build` then `vite build`; `client/package.json` build remains `vite build`; `client/dist/index.html` exists. |
| 8 | Bun unified server serves the built frontend bundle. | VERIFIED | `FRONTEND_DIST=../client/dist SERVER_RUNTIME=bun bun --cwd=server run test:runtime-smoke -- --assert-static` passed on retry with 15/15 checks, including `GET / returns 200` and `GET / returns HTML`. |
| 9 | D-04 mirrors Phase 5 default/fallback convention. | VERIFIED | Phase 5 established Bun defaults with `*:node` rollback aliases; Phase 6 root scripts now expose matching `:bun`/`:node` command families and docs list Bun defaults first. |

**Score:** 9/9 truths verified

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Docker, CI, `check`, and test script migration under Bun | Phase 7 | ROADMAP Phase 7 success criteria cover oven/bun Docker, GitHub Actions, and Bun check/test scripts; REQUIREMENTS.md maps OPS-01..OPS-04 to Phase 7. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `package.json` | Bun-default root script contract, npm/Node fallbacks, root `concurrently`, `lockfiles:refresh` | VERIFIED | Script assertion passed; `devDependencies.concurrently` is `^9.2.0`. |
| `bun.lock` | Root Bun lockfile | VERIFIED | Tracked, 63 lines, contains `concurrently`. |
| `package-lock.json` | Root npm fallback lockfile | VERIFIED | Tracked, lockfileVersion 3, root devDependency `concurrently`. |
| `client/bun.lock` | Client Bun lockfile | VERIFIED | Tracked, 2068 lines, contains Vite and client dependencies. |
| `client/package-lock.json` | Client npm fallback lockfile | VERIFIED | Tracked, lockfileVersion 3, contains client dependency graph. |
| `server/bun.lock` | Server Bun lockfile | VERIFIED | Tracked, 451 lines, contains Express, RDKit, and smoke test deps. |
| `server/package-lock.json` | Server npm fallback lockfile | VERIFIED | Tracked, lockfileVersion 3, contains server dependency graph. |
| `README.md` | Developer-facing Bun defaults, npm/Node fallbacks, lockfile rule | VERIFIED | Documents `bun run install:all/dev/build/start`, npm fallbacks, Vite retained, and `lockfiles:refresh`. |
| `CLAUDE.md` | Agent/developer command guidance | VERIFIED | Documents same Bun defaults, npm/Node fallbacks, Vite retained, and dual-lockfile rule. |
| `.planning/phases/06-package-management/BUN-PACKAGE-MANAGEMENT.md` | PKG-03 verification report | VERIFIED | Records lockfile inventory, script contract, Vite retained, `--assert-static`, and static assertions. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `package.json` | `client/package.json` | `bun --cwd=client run build` | WIRED | `bun run build` invoked client `vite build` successfully. |
| `package.json` | `server/package.json` | `bun --cwd=server run start:unified:bun` / `start:bun` | WIRED | Root `start` and `start:api` route to server Bun scripts. |
| `package.json` | npm fallback lockfiles | `install:all:node` and npm dry-run | WIRED | `npm ci --ignore-scripts --dry-run` at root/client/server exited 0. |
| `README.md` / `CLAUDE.md` | `package.json` | Documented commands | WIRED | Documented commands match root script names and default/fallback ordering. |
| `BUN-PACKAGE-MANAGEMENT.md` | `server/test/runtime-smoke.test.mjs` | `--assert-static` | WIRED | Smoke harness contains `--assert-static` and assertions for `/` returning 200 and HTML. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `client/dist` served by `server/index.js` | `FRONTEND_DIST_PATH` | `process.env.FRONTEND_DIST || '../client/dist'`, `express.static(FRONTEND_DIST_PATH)`, fallback `index.html` | Yes | VERIFIED by `--assert-static` smoke: `GET / returns 200` and `GET / returns HTML`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Root Bun install lockfile validity | `bun install --frozen-lockfile` | Checked installs, no changes | PASS |
| Client Bun install lockfile validity | `bun install --frozen-lockfile` in `client/` | Completed successfully | PASS |
| Server Bun install lockfile validity | `bun install --frozen-lockfile` in `server/` | Completed successfully | PASS |
| npm fallback lockfile validity | `npm ci --ignore-scripts --dry-run` at root/client/server | Exited 0; client emitted existing peer warnings | PASS |
| Bun Vite build | `bun run build` | Passed; invoked `vite build`; produced `client/dist` | PASS |
| Static serving under Bun | `FRONTEND_DIST=../client/dist SERVER_RUNTIME=bun bun --cwd=server run test:runtime-smoke -- --assert-static` | First run hit MongoMemoryServer 10s startup timeout; retry passed 15/15 with static assertions | PASS |
| Node/npm fallback build | `npm run build:node` | Passed; invoked client `vite build` | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| None declared | `find scripts -path '*/tests/probe-*.sh'` and phase plan/summary grep | No phase probes found | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| PKG-01 | 06-01-PLAN.md | Root and client dependencies install via `bun install`, producing committed `bun.lock` | SATISFIED | Root/client/server frozen Bun installs passed; all three `bun.lock` files are tracked. D-03 extends coverage to server. |
| PKG-02 | 06-01-PLAN.md, 06-02-PLAN.md | install/dev/build/start scripts have Bun equivalents while Node fallback path is preserved | SATISFIED | Root script contract verified; README.md and CLAUDE.md document Bun defaults and npm/Node fallbacks. |
| PKG-03 | 06-02-PLAN.md | Client Vite build produces working bundle when invoked through Bun | SATISFIED | `bun run build` passed through Vite; `--assert-static` runtime smoke passed on retry. |

No orphaned Phase 6 requirements found: REQUIREMENTS.md maps PKG-01, PKG-02, and PKG-03 to Phase 6, and all are claimed by phase plans.

### Locked Decision Coverage

| Decision | Status | Evidence |
|---|---|---|
| D-01: keep both lockfile families | VERIFIED | Root/client/server all have tracked `bun.lock` and `package-lock.json`; npm fallback dry-runs exited 0. |
| D-02: regenerate both lockfiles together | VERIFIED | `lockfiles:refresh` includes Bun installs plus npm `--package-lock-only`; README.md and CLAUDE.md document the rule. |
| D-03: root + client + server roots covered | VERIFIED | Root scripts and docs cover all three package roots. |
| D-04: mirror Phase 5 default/fallback convention | VERIFIED | Bun defaults and `:bun`/`:node` aliases are present; docs list Bun defaults first and fallback second. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| None | - | Debt/stub scan found no `TBD`, `FIXME`, `XXX`, placeholder, or empty implementation patterns in phase-modified files | - | No blocker patterns found. |

### Human Verification Required

None.

### Gaps Summary

No blocking gaps found. Phase 6 package management is implemented and wired: Bun installs work at all three package roots, both lockfile families are tracked, script defaults use Bun with npm/Node fallback aliases, docs expose the fallback path, Vite remains the client bundler, and the Bun unified server serves the built frontend.

Docker, CI, `check`, and test script migration are intentionally deferred to Phase 7 and are not Phase 6 blockers.

---

_Verified: 2026-06-05T07:33:04Z_
_Verifier: the agent (gsd-verifier)_
