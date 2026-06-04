---
phase: 04-compatibility-spike-baseline
plan: 01
subsystem: api
tags: [bun, stripe, rdkit, wasm, compatibility]
requires: []
provides:
  - Stripe webhook signature verification proof under Bun using constructEventAsync
  - Tampered Stripe signature rejection proof under Bun
  - RDKit WASM load and molecule parse proof under Bun
  - Phase 5 Stripe sync-to-async handoff
affects: [phase-05-runtime-migration, stripe, rdkit]
tech-stack:
  added: []
  patterns:
    - Standalone Bun spike scripts resolve server dependencies from server/package.json
key-files:
  created:
    - spike/04-stripe.ts
    - spike/05-rdkit.ts
    - spike/STRIPE-HANDOFF.md
  modified: []
key-decisions:
  - "Production Stripe webhook code remains unchanged in Phase 4; Phase 5 owns the server/index.js sync-to-async migration."
  - "Stripe spike proves both positive verification and tampered-signature rejection, so verification is not weakened."
patterns-established:
  - "Spike scripts live under spike/ and run from repo root with bun run."
requirements-completed: [CMPT-04, CMPT-05]
duration: 12 min
completed: 2026-06-04
---

# Phase 04 Plan 01: Stripe and RDKit Bun Compatibility Summary

**Stripe async webhook verification and RDKit WASM molecule parsing both run successfully under Bun 1.3.14.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-04T15:49:00Z
- **Completed:** 2026-06-04T16:01:01Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added a standalone Stripe spike that verifies a valid signature with `constructEventAsync`.
- Added a mandatory negative Stripe check that rejects a tampered signature.
- Added a standalone RDKit spike that loads WASM, parses benzene, and prints canonical SMILES.
- Captured the required Phase 5 production handoff for `server/index.js` and `server/test/stripe-webhook.test.mjs`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Stripe webhook verification spike** - `a2965f4` (feat)
2. **Task 2: RDKit WASM spike** - `cb57f8f` (feat)
3. **Task 3: Stripe sync-to-async handoff** - `7d1066b` (docs)

## Files Created/Modified

- `spike/04-stripe.ts` - Verifies a valid Stripe webhook signature and rejects a tampered signature under Bun.
- `spike/05-rdkit.ts` - Loads `@rdkit/rdkit` WASM from `server/node_modules` and parses benzene under Bun.
- `spike/STRIPE-HANDOFF.md` - Documents the required Phase 5 production and test migration to `constructEventAsync`.

## Verification

- `bun run spike/04-stripe.ts` passed, printing `valid signature parsed event type: checkout.session.completed` and `tampered payload correctly rejected`.
- `bun run spike/05-rdkit.ts` passed, printing `RDKit version: 2025.03.4` and `benzene canonical SMILES: c1ccccc1`.
- `grep -n "constructEvent(" spike/04-stripe.ts || true` returned no sync call matches.
- `grep -nE "sk_(live|test)" spike/04-stripe.ts spike/STRIPE-HANDOFF.md || true` returned no secret key literals.
- Handoff checks confirmed `constructEventAsync`, `server/index.js`, `server/test/stripe-webhook.test.mjs`, and `createNodeCryptoProvider` are documented.

## Decisions Made

The spike scripts resolve server-only dependencies from `server/package.json` so the required repo-root commands work without adding root dependencies. Production Stripe code was not edited because the Phase 4 plan is a proof and handoff, not the runtime migration.

## Deviations from Plan

None - plan executed exactly as written.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 5 has a durable handoff for the Stripe webhook migration. CMPT-04 and CMPT-05 are proven under Bun and ready for phase-level verification.

## Self-Check: PASSED

All key files exist, all automated checks passed, no sync Stripe verification call was added to the spike script, and no secret key literals were committed.

---
*Phase: 04-compatibility-spike-baseline*
*Completed: 2026-06-04*
