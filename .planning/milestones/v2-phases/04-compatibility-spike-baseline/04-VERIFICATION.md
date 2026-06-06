---
phase: 04-compatibility-spike-baseline
status: verified
verified: 2026-06-04
requirements:
  - CMPT-01
  - CMPT-02
  - CMPT-03
  - CMPT-04
  - CMPT-05
  - CMPT-06
  - MEAS-01
human_needed: false
---

# Phase 04 Verification

## Verdict

Phase 04 achieved its goal: Bun compatibility was empirically proven for the scoped dependencies and deployment unit, and Node baseline metrics were captured for Phase 5 comparison.

## Requirement Verification

| Requirement | Status | Evidence |
|-------------|--------|----------|
| CMPT-01 | PASS | `spike/01-boot-health.ts` booted unmodified `server/index.js` under Bun on `oracle`; `/health` returned HTTP 200 with `status: "OK"`. |
| CMPT-02 | PASS | `spike/02-mongo.ts` connected to live MongoDB under Bun, inserted, found, created `marker_1`, and dropped `bun_spike_test`. |
| CMPT-03 | PASS | `spike/03-amqp.ts` published and consumed the same RabbitMQ payload under Bun; no `Invalid frame` error occurred. |
| CMPT-04 | PASS | `spike/04-stripe.ts` verified a valid Stripe webhook signature with `constructEventAsync` and rejected a tampered signature. |
| CMPT-05 | PASS | `spike/05-rdkit.ts` loaded RDKit WASM under Bun and parsed benzene (`c1ccccc1`). |
| CMPT-06 | PASS | `spike/run-container-check.sh` built pinned `oven/bun:1.3.14-slim` arm64 image and verified container `/health` returned HTTP 200. |
| MEAS-01 | PASS | `BASELINE.md` records numeric Node medians: idle RSS 118.9 MiB, under-load RSS 219.7 MiB, cold start 764 ms, cold npm install 4.38 s, CI wall-clock 68 s. |

## Automated Checks

- `npm run check` passed.
- `node --check spike/load-gen.mjs` passed.
- `node --check spike/baseline-capture.mjs` passed.
- `bun run spike/04-stripe.ts` passed locally.
- `bun run spike/05-rdkit.ts` passed locally.
- Docker/Bun/Mongo/RabbitMQ/container checks passed on `ssh oracle`.
- Schema drift gate returned `drift_detected: false`.
- Code review status: clean after commit `33579ae`.

## Methodology Notes

- Local Docker was unavailable, so live-service and container checks ran on `oracle` from isolated `/tmp` bundles.
- The `oracle` host already had port 3000 allocated, so the container proof used `HOST_PORT=3300` while preserving container app port 3000.
- Baseline capture ran in a `node:22-slim` arm64 container on `oracle`, using N=5 and Linux VmRSS from `/proc/<pid>/status`.
- Load baseline used only deterministic endpoints: `/health` and `/health/db`.

## Follow-Up For Phase 5

- Apply the Stripe production migration recorded in `spike/STRIPE-HANDOFF.md`: use `await stripe.webhooks.constructEventAsync(...)` in `server/index.js` and keep webhook tests aligned.
- Reuse `spike/load-gen.mjs`, N=5, `/health` + `/health/db`, and VmRSS boundary when measuring Bun metrics.
- Compare Bun results against `BASELINE.md` for MEAS-02/MEAS-03.

## Security Gate Note

No `04-SECURITY.md` exists yet. If security enforcement is required before phase transition, run `$gsd-secure-phase 04`.
