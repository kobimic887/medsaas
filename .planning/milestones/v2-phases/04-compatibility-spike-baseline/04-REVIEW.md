---
phase: 04-compatibility-spike-baseline
status: clean
reviewed: 2026-06-04
scope:
  - spike/01-boot-health.ts
  - spike/02-mongo.ts
  - spike/03-amqp.ts
  - spike/04-stripe.ts
  - spike/05-rdkit.ts
  - spike/Dockerfile.bun
  - spike/run-container-check.sh
  - spike/load-gen.mjs
  - spike/baseline-capture.mjs
  - spike/README.md
---

# Phase 04 Code Review

## Verdict

Clean after one hygiene fix.

## Findings

### Fixed During Review

**Secret-shaped dummy keys in spike scripts**

- **Severity:** Info
- **Files:** `spike/01-boot-health.ts`, `spike/run-container-check.sh`, `spike/baseline-capture.mjs`
- **Issue:** Dummy Stripe values used `sk_test...` prefixes. They were not real secrets, but they looked like Stripe key literals and would create noisy secret scans.
- **Fix:** Replaced them with non-key-shaped dummy strings in commit `33579ae`.
- **Verification:** `rg "sk_test|sk_live|whsec" spike BASELINE/SUMMARY files` returns no matches outside the original plan text.

## Checks

- `npm run check` passed.
- `node --check spike/load-gen.mjs` passed.
- `node --check spike/baseline-capture.mjs` passed.
- Docker/Bun live-service and container checks passed on `oracle`.
- Schema drift check reported `drift_detected: false`.

## Residual Risk

`spike/baseline-capture.mjs` intentionally removes `server/node_modules` while measuring cold install time. This is documented in the script and was executed only in an isolated `/tmp` bundle on `oracle`.
