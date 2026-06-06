---
phase: 05-server-runtime-on-bun
verified: 2026-06-05T00:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification: null
gaps: []
deferred: []
human_verification: []
---

# Phase 5: Server Runtime on Bun — Verification Report

**Phase Goal:** The Express API runs on the Bun runtime in both dev and production, and measured before/after RAM and startup data gates the outcome.
**Verified:** 2026-06-05
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `bun --watch index.js` in dev serves the API with working file-watch reload | VERIFIED | `npm --prefix server run test:runtime-watch` — 4/4 checks pass: initial /health 200, content-preserving file touch, reload signal detected, post-reload /health 200. Probe exit 0. |
| 2 | The production server starts on Bun, serves the built frontend, and smoke tests pass for auth, Stripe webhook, and one token-consuming simulation endpoint | VERIFIED | `SERVER_RUNTIME=bun npm --prefix server run test:runtime-smoke` — 13/13 pass (auth, health, Stripe valid+forged, token decrement+exhaustion). `--assert-static` run — 15/15 pass including GET / returning built frontend HTML. Probe exit 0. |
| 3 | Bun RSS (idle and under load) and startup time are measured and compared to Phase 4 baseline in a written before/after report | VERIFIED | `BUN-BEFORE-AFTER.md` present: N=5, `/proc/<pid>/status` VmRSS, oracle aarch64 Linux host, load via `spike/load-gen.mjs` 30s@20, per-sample distributions, back-to-back Node sanity run, Phase 4 baseline values (118.9/219.7/764). Cannot re-run on macOS (no /proc); verified by artifact consistency. |
| 4 | If Bun does not reduce server RAM, Node remains default; the Node run script is retained and documented as a one-command rollback | VERIFIED | Gate Result: PASS — Bun median idle RSS 115.1 MiB < 118.9 MiB baseline. `server/package.json` `start: bun index.js` matches gate outcome. All `*:node` and `*:bun` aliases present at server and root level. README documents exact rollback commands. |

**Score: 4/4 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/package.json` | Default Bun server scripts plus node and bun aliases | VERIFIED | `start: bun index.js`, `dev: bun --watch index.js`, `start:unified: FRONTEND_DIST=../client/dist bun index.js`; `:bun` and `:node` alias pairs all present; `start:unified:node` present |
| `package.json` | Root npm wrapper rollback commands | VERIFIED | `start:bun`, `start:node`, `start:api:bun`, `start:api:node`, `dev:bun`, `dev:node` all present; all route through `npm --prefix server run`; no `bun run` usage |
| `README.md` | Bun runtime and Node rollback commands documented | VERIFIED | "Bun runtime and Node rollback" subsection present; gate result stated; `npm run start:node`, `npm --prefix server run start:unified:node`, `npm run dev:node`, `npm run start:bun` all documented; BUN-BEFORE-AFTER.md referenced |
| `spike/runtime-env-check.mjs` | Runtime availability probe with --target, --host, --output, --require | VERIFIED | File present; supports all 4 flags; local/oracle target; exits non-zero only for missing required binaries |
| `.planning/phases/05-server-runtime-on-bun/RUNTIME-ENV.md` | Recorded execution host runtime versions | VERIFIED | Records bun 1.3.14, node v22.22.3, npm 10.9.8; exact oracle probe command form; execution path table |
| `server/index.js` | `await stripe.webhooks.constructEventAsync` replacing sync call | VERIFIED | Line 99: `await stripe.webhooks.constructEventAsync(...)`. No `stripe.webhooks.constructEvent(` call present. Route at line 92, before `app.use(express.json)` at line 122 — order confirmed. |
| `server/test/runtime-smoke.test.mjs` | Runtime-parametric auth, Stripe, token, health, and static smoke | VERIFIED | Imports bcryptjs, mongodb-memory-server, mongodb, stripe. Tests /api/signin, /health, /health/db, /stripe/webhook (valid+forged), /api/generate-molecules token decrement+exhaustion. Accepts `SERVER_RUNTIME` env. 13/13 pass under Bun, 15/15 with --assert-static. |
| `server/test/runtime-watch-smoke.mjs` | Bun --watch reload proof | VERIFIED | Spawns `BUN_PATH --watch index.js`; performs content-preserving readFile+writeFile on config/branding.js; asserts initial health, reload signal, post-reload health. 4/4 pass. |
| `spike/runtime-capture.mjs` | Runtime-parametric RSS/startup capture for Bun and Node | VERIFIED | Present; supports --runtime, --compare-runtime, --runs, --port, --load-duration, --load-concurrency, --baseline, --output; rejects runs<5; reads `/proc/<pid>/status` VmRSS; spawns `spike/load-gen.mjs`; writes Markdown report |
| `.planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md` | Before/after metrics, distributions, deltas, and default-runtime gate result | VERIFIED | Contains "Gate Result: PASS - Bun remains default"; Phase 4 baseline reference values (118.9, 219.7, 764); Bun per-sample distributions; back-to-back Node sanity run; methodology section with /proc/<pid>/status, spike/load-gen.mjs, N=5, duration 30, concurrency 20 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `package.json` | `server/package.json` | `npm --prefix server run start:unified` | VERIFIED | `start` script: `npm run build && npm --prefix server run start:unified`; pattern confirmed |
| `README.md` | `server/package.json` | documented rollback command | VERIFIED | `npm --prefix server run start:unified:node` present at README line 89 |
| `server/test/runtime-smoke.test.mjs` | `server/index.js` | spawn runtime index.js and HTTP calls | VERIFIED | `spawn(runtimeBin, ['index.js'], { cwd: SERVER_DIR })` with HTTP assertions |
| `server/index.js` | Stripe SDK | `await stripe.webhooks.constructEventAsync` | VERIFIED | Line 99 confirmed; no sync fallback |
| `server/test/runtime-smoke.test.mjs` | `/api/generate-molecules` | Authorization: Bearer token | VERIFIED | Smoke seeds token=1, calls endpoint with auth header, asserts decrement and exhaustion |
| `spike/runtime-capture.mjs` | `spike/load-gen.mjs` | spawn load generator | VERIFIED | `"spike/load-gen.mjs"` at line 299 |
| `BUN-BEFORE-AFTER.md` | `BASELINE.md` (Phase 4) | Phase 4 baseline table | VERIFIED | 118.9, 219.7, 764 values referenced |
| `BUN-BEFORE-AFTER.md` | `server/package.json` | Gate Result determines default scripts | VERIFIED | Gate PASS → `start: bun index.js` (confirmed in server/package.json) |

---

### Data-Flow Trace (Level 4)

N/A — this phase produces no dynamic-data-rendering UI artifacts. All artifacts are server entrypoints, scripts, test harnesses, and planning documents.

---

### Behavioral Spot-Checks (Probes)

| Probe / Behavior | Command | Result | Status |
|-----------------|---------|--------|--------|
| Bun runtime parity smoke (SC2 auth/webhook/token) | `SERVER_RUNTIME=bun npm --prefix server run test:runtime-smoke` | 13/13 passed, exit 0 | PASS |
| Bun production static serving (SC2 frontend) | `npm run build && FRONTEND_DIST=../client/dist SERVER_RUNTIME=bun npm --prefix server run test:runtime-smoke -- --assert-static` | 15/15 passed, exit 0 | PASS |
| Bun --watch reload (SC1) | `npm --prefix server run test:runtime-watch` | 4/4 passed, exit 0 | PASS |
| SC3 RSS measurement (Linux /proc) | Cannot re-run on macOS (no /proc); artifact-verified | BUN-BEFORE-AFTER.md present; per-sample distributions, Node sanity run, methodology all documented; gate outcome consistent with server/package.json default | PASS (artifact) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| RUN-01 | 05-01, 05-02 | Express API runs in dev on `bun` with working file-watch reload | SATISFIED | `dev: bun --watch index.js`; watch smoke 4/4 |
| RUN-02 | 05-01, 05-02 | Express API runs in production on `bun`, serving the built frontend | SATISFIED | `start:unified: FRONTEND_DIST=../client/dist bun index.js`; --assert-static smoke 15/15 |
| RUN-03 | 05-02 | Startup env-var validation and all middleware/routes behave identically under Bun, verified by smoke of auth, Stripe webhook, and one token-consuming simulation endpoint | SATISFIED | runtime-smoke 13/13 under Bun: signin/JWT, health, Stripe valid+forged, token decrement+exhaustion |
| RUN-04 | 05-01, 05-03 | Node-compatible run scripts retained and documented as fast-rollback fallback | SATISFIED | `start:node`, `dev:node`, `start:unified:node` in server/package.json; 6 root aliases; README rollback section |
| MEAS-02 | 05-03 | Post-migration Bun metrics captured with same method, compared against baseline in before/after report | SATISFIED | BUN-BEFORE-AFTER.md: N=5, VmRSS, same oracle arm64 host, per-sample distributions, delta table |
| MEAS-03 | 05-03 | Migration outcome gated on measured results; if Bun does not reduce RAM, Node remains default | SATISFIED | Gate Result: PASS (115.1 < 118.9); server/package.json start = bun index.js matches gate |

**No orphaned requirements.** REQUIREMENTS.md maps RUN-01, RUN-02, RUN-03, RUN-04, MEAS-02, MEAS-03 to Phase 5 — all six accounted for by the three plans.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | — |

No TBD, FIXME, XXX, PLACEHOLDER, TODO, or HACK markers found in any phase-5 modified file.

---

### Human Verification Required

None — all success criteria verified programmatically. Production-mode behavior (SC2 "serves the built frontend") was confirmed by the `--assert-static` smoke run on this host.

---

## Gaps Summary

No gaps. All four ROADMAP success criteria are verified by live probe execution on this host. The RSS measurement (SC3) cannot be re-executed on macOS but is verified by artifact consistency: BUN-BEFORE-AFTER.md contains methodology, per-sample distributions, back-to-back Node sanity run, and the Gate Result value that is confirmed reflected in `server/package.json` defaults.

**Measurement interpretation note (informational):** The back-to-back same-machine Node sanity run recorded 115.5 MiB idle versus Bun's 115.1 MiB — these are within sample noise (Bun range 114.4–115.4; Node range 111.7–118.2). The measured RAM advantage of Bun is effectively neutral on this machine. The gate is explicitly defined as "Bun median idle RSS < 118.9 MiB" (D-06), and the comparison target is the Phase 4 Node baseline (118.9 MiB), not the back-to-back same-machine Node run. The gate applies as specified and the PASS verdict stands.

---

_Verified: 2026-06-05_
_Verifier: Claude (gsd-verifier)_
