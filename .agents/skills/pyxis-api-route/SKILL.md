---
name: pyxis-api-route
description: >-
  Add or change Pyxis Discovery Express API routes with the correct auth,
  active-user, and credit middleware, plus 401/403/502 status rules. Use when
  editing server/index.js or server/routes/*, adding /api endpoints, proxies,
  Stripe credit flows, or fixing session-logout bugs from wrong status codes.
---

# Pyxis API route

## Canonical sources

- Main API: `server/index.js` (`authenticateToken`, `requireActiveUser`,
  `consumeSimulationToken` / `chargeSimulationToken` / `refundSimulationToken`,
  Stripe checkout + webhook)
- Scientific proxies: `server/routes/scientificServices.js`
- Product rules: `AGENTS.md` (401 vs 403; credits from Stripe webhook only)

## Default middleware chain

Protected product routes:

```text
ensureMongoConnected → authenticateToken → requireActiveUser → [consumeSimulationToken('feature')] → handler
```

- Admin-only surfaces (e.g. some checkout): `requireCompanyAdmin` instead of
  or after `requireActiveUser` when that is the existing pattern.
- Worker callbacks with shared secrets: **403** on bad secret, never 401
  (example: ADMET callback) so the SPA does not log the user out.

## Status code contract

| Situation | Status | Why |
|-----------|--------|-----|
| Missing / invalid / expired JWT | **401** | Client interceptor clears session |
| Authenticated but forbidden (disabled user/company, wrong role, no credits) | **403** | Must not log out |
| Bad input | **400** | Validation |
| Upstream auth failure on a proxy (NVIDIA, ligand, etc.) | **502** via `relayUpstreamStatus` | Upstream 401 ≠ user session |
| Stripe / billing misconfig | **503** when that is existing behavior | |

Never return same-origin **401** for authorization or upstream credential failures.

## Credits

1. Grant tokens **only** from the verified Stripe webhook (metadata username +
   credits). Never trust the client to increment `simulationTokens`.
2. Metered science routes: charge with `consumeSimulationToken(feature)` or
   inline `chargeSimulationToken` matching neighbors.
3. Refund with `refundSimulationToken` when the paid work did not happen
   (upstream down, validation fail). Safe in `catch`; clears the flag.
4. Persisted/cacheable docks (`/api/simulation`): follow existing
   `refundOnDisconnect: false` rules — do not invent a new refund policy.
5. Error-status refunds must run at `res.end()`, independently of `finish`:
   Bun may emit neither response `finish` nor `close` after a client disconnect.
   Request `close` also fires on completed bodies, so never use it to refund.
   Keep the best-effort response `close` listener and the explicit-refund guard.
   Regression: `bun server/test/credit-refund.test.mjs` (real HTTP disconnect).
6. Do not add new tenant or billing products unless the user explicitly asks.

## Plan checkout

Use `PLAN_CATALOG`, `getPlan`, and `buildPlanCheckoutSessionParams` from
`server/utils/planCheckout.js` for both existing plan routes. Credit packs use
one-time `payment` sessions and return to `/dashboard/paid-plans`. Preserve the
separate molecule-cart branch and verified webhook fulfillment. Check the actual
route wiring as well as the helper; a passing helper test alone does not prove
that a route uses it.

## Proxies

- Catalog/shop retirement does not disable configured Asinex docking or DiffDock
  in production/full staging. Keep SSRF checks and refund upstream failures.
- DiffDock workload comes from server `DIFFDOCK_NUM_POSES` (1–100, default 100),
  validated before charging. Do not silently cap the requested workload. Failed
  or incomplete pose envelopes, including HTTP 200/status=failed, return 502 and
  refund explicitly. Ship `server/utils/diffdockResult.js`; verify with
  `bun server/test/diffdock-route.test.mjs` (actual route + HTTP fixtures).
  `resolveDiffDockUrl` lets an explicit platform endpoint replace only the exact
  seeded Asinex default in old company records; independent endpoints and SSRF
  refusals stay intact. Endpoint cutover must not require rewriting shared Atlas.
  Docking uses `resolveDockingUrl` for the same seeded-default cutover. New/backfilled
  company configs omit inherited endpoints; admin saves use
  `persistedLigandServiceConfig` so rollback cannot strand stored loopback defaults.
  Validate docking receptor/SDF strings before caching and charging success.

- Remap upstream **401 → 502** (`relayUpstreamStatus` / scientific router).
- Encode path params; do not concatenate untrusted path segments.
- Prefer existing ligand/SSRF helpers over raw user-supplied URLs.
- Linker bulk export supports older shared services through bounded, owner-scoped
  terminal job/detail aggregation only for a missing native route. Preserve native
  job/result refusals, partial provenance and atomic failure on changed history;
  staging deployment must not require a shared scientific-service restart.

Long-running science also requires the app nginx server-block include
`deploy/nginx/scientific-timeouts.conf` (650s proxy read timeout versus the
600s inference budget). Changing source does not update live nginx.

## Client callers

Protected `fetch` to `/api/*` must send `Authorization: Bearer` (see
`scripts/check-authed-fetch.mjs`). Public routes are the exception list there.

## Verify

- Nearest `server/test/*.mjs` (stripe, tenant, ssrf, runtime-smoke).
- `bun run test` or the focused `npm --prefix server run test:*` script.
- For UI callers: `bun run test:authed-fetch` when adding client `fetch`.
---
