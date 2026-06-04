---
phase: 05-server-runtime-on-bun
plan: 02
subsystem: infra
tags: [bun, node, stripe, webhook, smoke-test, runtime-parity, watch-reload]

# Dependency graph
requires:
  - phase: 05-01
    provides: Bun default server scripts, RUNTIME-ENV.md
provides:
  - Async Stripe webhook verification (constructEventAsync) in server/index.js
  - server/test/stripe-webhook.test.mjs updated to accept SERVER_RUNTIME env
  - server/test/runtime-smoke.test.mjs: auth, webhook, token, static smoke under Bun and Node
  - server/test/runtime-watch-smoke.mjs: Bun --watch reload proof
affects: [05-03, phase-06-pkg-bun, phase-07-docker-bun]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - constructEventAsync pattern: Stripe webhook handler awaits constructEventAsync for Bun compat (D-08, D-09)
    - ephemeral-env smoke: child env overrides NVIDIA_MOLMIM_API_KEY with empty string to prevent dotenv re-read from restoring it
    - content-preserving rewrite trigger: fsp.readFile+writeFile with identical content triggers Bun FSEvents watch (mtime-only utimes does not)

key-files:
  created:
    - server/test/runtime-smoke.test.mjs
    - server/test/runtime-watch-smoke.mjs
  modified:
    - server/index.js
    - server/test/stripe-webhook.test.mjs

key-decisions:
  - "constructEventAsync replaces constructEvent in /stripe/webhook handler for Bun compatibility (D-08, D-09)"
  - "Smoke harness passes NVIDIA_MOLMIM_API_KEY='' as explicit empty string because dotenv skips variables already in process.env (delete alone is insufficient when server reads ../.env)"
  - "Bun FSEvents watch requires actual inode/content change; fs.utimes mtime-only does not trigger reload on macOS — content-preserving readFile+writeFile is used instead"

requirements-completed: [RUN-01, RUN-02, RUN-03]

# Metrics
duration: 35min
completed: 2026-06-05
---

# Phase 05 Plan 02: Bun Runtime Parity Smoke Summary

**Async Stripe webhook verification and executable smoke scripts proving Bun serves, authenticates, verifies webhooks, consumes tokens, and reloads on file change — passing under both Bun and Node runtimes.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-04T21:00:04Z
- **Completed:** 2026-06-05T00:00:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Replaced `stripe.webhooks.constructEvent(...)` with `await stripe.webhooks.constructEventAsync(...)` in `/stripe/webhook` handler; kept handler `async`, raw body middleware order, and 400-on-bad-sig (D-08, D-09)
- Updated `server/test/stripe-webhook.test.mjs` to accept `SERVER_RUNTIME` env var; resolves bun binary via `BUN_PATH` fallback to `$HOME/.bun/bin/bun`
- Created `server/test/runtime-smoke.test.mjs`: 13-check ESM harness covering `/api/signin` JWT, `/health`+`/health/db`, valid+forged Stripe webhook, token decrement+exhaustion on `/api/generate-molecules`, optional `--assert-static`; both Node and Bun pass
- Created `server/test/runtime-watch-smoke.mjs`: 4-check harness spawning `bun --watch index.js`, touching `config/branding.js`, asserting reload via startup-log count, post-reload health check

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate Stripe webhook to constructEventAsync** - `ccb2a79` (feat)
2. **Task 2: Add runtime parity smoke (auth, Stripe, token, static)** - `0585c1e` (feat)
3. **Task 3: Add Bun --watch dev reload smoke** - `36fed6b` (feat)

## Files Created/Modified

- `server/index.js` — `/stripe/webhook` handler now uses `constructEventAsync`; express.raw middleware order preserved above express.json
- `server/test/stripe-webhook.test.mjs` — Added SERVER_RUNTIME/BUN_PATH support; spawns bun or node based on env var
- `server/test/runtime-smoke.test.mjs` — Full runtime parity smoke: signin, health, Stripe webhook (valid+forged), token decrement/exhaustion, optional static assert
- `server/test/runtime-watch-smoke.mjs` — Bun --watch reload proof: startup, file touch, reload detection, post-reload health

## Decisions Made

- `constructEventAsync` is drop-in compatible with `constructEvent` in the existing handler — no other changes needed to the webhook fulfillment path.
- `NVIDIA_MOLMIM_API_KEY=''` (empty string) is passed explicitly in child env rather than `delete childEnv.NVIDIA_MOLMIM_API_KEY` because the server's `configDotenv` re-reads the root `.env` file, which restores the key. dotenv only skips variables already present in `process.env` (even as empty string).
- Bun's FSEvents watcher on macOS responds to file inode changes (content write) but not to `utimes`-only mtime updates. A content-preserving `readFile+writeFile` reliably triggers reload.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Explicit empty NVIDIA key override in child env**
- **Found during:** Task 2
- **Issue:** After `delete childEnv.NVIDIA_MOLMIM_API_KEY`, the server re-loaded the `.env` file via `configDotenv` at startup and restored `NVIDIA_MOLMIM_API_KEY` from the root `.env`. The first `/api/generate-molecules` call then made an actual NVIDIA API request and returned 401 instead of 500.
- **Fix:** Pass `NVIDIA_MOLMIM_API_KEY: ''` explicitly in `childEnvFinal` so dotenv sees it as already-set and leaves it alone.
- **Files modified:** server/test/runtime-smoke.test.mjs
- **Commit:** 0585c1e

**2. [Rule 1 - Bug] Content-preserving rewrite instead of utimes for Bun watch trigger**
- **Found during:** Task 3
- **Issue:** `fs.utimes(BRANDING_FILE, now, now)` updates mtime but does not trigger Bun's FSEvents-based `--watch` on macOS. The watch never fired during 20-second test windows.
- **Fix:** Replace `utimes` with `fsp.readFile(BRANDING_FILE)` + `fsp.writeFile(BRANDING_FILE, sameContent)`. The content is byte-identical; only the inode ctime changes, which Bun's FSEvents watcher detects.
- **Files modified:** server/test/runtime-watch-smoke.mjs
- **Commit:** 36fed6b

---

**Total deviations:** 2 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Both fixes preserved the test's stated behavior (no external API calls, no source text left modified). No scope changes.

## Stub Tracking

None — no UI rendering stubs or placeholder values introduced. All tests execute against real server code.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. The test files are execution-only; the only server change is the async Stripe method substitution in the existing /stripe/webhook handler.

## Self-Check: PASSED

- [x] server/index.js contains `constructEventAsync` (verified by grep)
- [x] server/index.js has no remaining `stripe.webhooks.constructEvent(` call (verified by ! grep check)
- [x] server/test/runtime-smoke.test.mjs exists
- [x] server/test/runtime-watch-smoke.mjs exists
- [x] SERVER_RUNTIME=node test:stripe — 8/8 passed
- [x] SERVER_RUNTIME=bun test:stripe — 8/8 passed
- [x] SERVER_RUNTIME=node test:runtime-smoke — 13/13 passed
- [x] SERVER_RUNTIME=bun test:runtime-smoke — 13/13 passed
- [x] test:runtime-watch — 4/4 passed
- [x] Commits ccb2a79, 0585c1e, 36fed6b confirmed in git log

---
*Phase: 05-server-runtime-on-bun*
*Completed: 2026-06-05*
