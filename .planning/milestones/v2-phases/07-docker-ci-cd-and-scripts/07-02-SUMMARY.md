---
phase: 07-docker-ci-cd-and-scripts
plan: 02
subsystem: scripts
tags: [bun, scripts, stripe, testing, ops]
dependency_graph:
  requires: [07-01]
  provides: [OPS-03]
  affects: [package.json, server/package.json, server/test/stripe-webhook.test.mjs]
tech_stack:
  added: []
  patterns: [bun-default-with-node-fallback, subtlecrypto-async-provider]
key_files:
  created: []
  modified:
    - server/test/stripe-webhook.test.mjs
    - package.json
    - server/package.json
decisions:
  - id: D-10
    summary: "bun build --target=bun replaces node --check as the Bun syntax/resolution gate (check script)"
    rationale: "Bun has no node --check equivalent; bun build parses + resolves the full server module graph (895 modules) and exits 0, serving as an equivalent syntax/resolution gate"
    alternative: "bun --eval require (rejected: incomplete module graph); node --check alias (rejected: not Bun-native)"
  - id: D-11
    summary: "test:stripe sets SERVER_RUNTIME=bun to exercise the production bun-server path end-to-end"
    rationale: "Bun is the default server runtime since Phase 5; the Bun-default test:stripe should verify the bun-server path, not just a node-spawned server"
    alternative: "No SERVER_RUNTIME env (rejected: leaves bun-server path untested by default)"
metrics:
  duration: "12 min"
  completed: "2026-06-05T10:10:03Z"
  tasks: 2
  files: 3
---

# Phase 7 Plan 02: Bun Script Migration (check, test:brand, test:stripe) Summary

**One-liner:** Migrated `check`, `test:brand` (root), and `test:stripe` (server) to Bun-default scripts with `:node` fallbacks; fixed Stripe test helper to use `generateTestHeaderStringAsync` for Bun SubtleCrypto compatibility.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Async Stripe test-header signing (Bun SubtleCrypto fix) | 4a561e1 | server/test/stripe-webhook.test.mjs |
| 2 | Bun-default check/test:brand/test:stripe scripts with :node fallbacks | 4a95c35 | package.json, server/package.json |

## What Was Built

**Task 1 — Async Stripe test helper:**
The `postEvent` function in `server/test/stripe-webhook.test.mjs` signed webhook payloads with `stripe.webhooks.generateTestHeaderString()` (synchronous). Under Bun's SubtleCrypto provider, this throws "SubtleCryptoProvider cannot be used in a synchronous context" — the same class of error Phase 5 solved for the webhook handler by switching to `constructEventAsync`. The fix is a single-line change: `await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret })`. The function was already `async`, so only `await` and the method name changed. This mirrors Phase 5 decisions D-08/D-09 in the test layer. The fix is Node-compatible — both `node test/...` and `bun test/...` pass 8/0.

**Task 2 — Script wiring (OPS-03):**
Three scripts now have Bun-default behavior and `:node` fallbacks following the established convention from Phases 5-6:

Root `package.json`:
- `check` / `check:bun`: `bun build server/index.js --target=bun --outfile=/dev/null && bun --cwd=client run build` (parses/resolves 895 server modules as Bun syntax gate, then runs Vite build via Bun)
- `check:node`: `node --check server/index.js && npm --prefix client run build` (retained original Node gate)
- `test:brand` / `test:brand:bun`: `bun scripts/check-brand.mjs`
- `test:brand:node`: `node scripts/check-brand.mjs`

Server `server/package.json`:
- `test:stripe` / `test:stripe:bun`: `SERVER_RUNTIME=bun bun test/stripe-webhook.test.mjs` (exercises bun-server production path, 8 passed / 0 failed)
- `test:stripe:node`: `node test/stripe-webhook.test.mjs` (node-spawned server; no SERVER_RUNTIME set)

## Acceptance Command Results

| Command | Exit Code | Notes |
|---------|-----------|-------|
| `bun run check` | 0 | 895 modules bundled; Vite build succeeded |
| `bun run test:brand` | 0 | Brand check passed: no retired-brand references |
| `cd server && bun run test:stripe` | 0 | 8 passed, 0 failed; server spawned via bun |
| Task 1 grep assertions | PASS | async call present, 0 remaining sync calls |
| Root :node fallbacks present | PASS | check:node, test:brand:node |
| Server :node fallback present | PASS | test:stripe:node |
| SERVER_RUNTIME=bun in server/package.json | PASS | |
| node --check retained in check:node | PASS | |

## Key Decisions

**D-10: bun build --target=bun as Bun syntax/resolution gate**
Bun has no `bun --check` equivalent. `bun build server/index.js --target=bun --outfile=/dev/null` parses and resolves the full module graph (895 modules, exits 0 in ~542ms) — this is option (b) from the migration decision and matches the scope of the prior `node --check` gate (syntax/resolution, not behavioral). The Node syntax gate is preserved under `check:node`.

**D-11: test:stripe sets SERVER_RUNTIME=bun**
Since Phase 5 made Bun the default server runtime, the Bun-default `test:stripe` should exercise the production path — the server spawned under Bun (not Node). `SERVER_RUNTIME=bun` makes the harness use the Bun binary for the spawned server process, exercising `constructEventAsync` and the Bun crypto path end-to-end.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The test helper change affects only the test harness crypto call (T-07-04: mitigated — async SubtleCrypto provider used, signature verification still exercised). No new threat surface.

## Self-Check: PASSED

- [x] `server/test/stripe-webhook.test.mjs` modified (Task 1)
- [x] `package.json` modified (Task 2)
- [x] `server/package.json` modified (Task 2)
- [x] Commit 4a561e1 exists (Task 1)
- [x] Commit 4a95c35 exists (Task 2)
- [x] All acceptance commands ran and exited 0
