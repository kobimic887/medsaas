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
5. Do not add new tenant or billing products unless the user explicitly asks.

## Proxies

- Remap upstream **401 → 502** (`relayUpstreamStatus` / scientific router).
- Encode path params; do not concatenate untrusted path segments.
- Prefer existing ligand/SSRF helpers over raw user-supplied URLs.

## Client callers

Protected `fetch` to `/api/*` must send `Authorization: Bearer` (see
`scripts/check-authed-fetch.mjs`). Public routes are the exception list there.

## Verify

- Nearest `server/test/*.mjs` (stripe, tenant, ssrf, runtime-smoke).
- `bun run test` or the focused `npm --prefix server run test:*` script.
- For UI callers: `bun run test:authed-fetch` when adding client `fetch`.
---
