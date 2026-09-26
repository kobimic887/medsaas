---
name: pyxis-feature-slice
description: >-
  Ship a Pyxis feature across client + server and pick the right test harness
  (server/test *.mjs or scripts/check-*-lifecycle.mjs). Use when adding a
  dashboard flow, API+UI change, scientific viewer path, Simulation source,
  basket or checkout behavior. Chooses the smallest relevant verification.
---

# Pyxis feature slice

Trace the user-visible path through the existing client and server boundaries.
Change only the layers needed for the requested outcome; UI-only work can stay
UI-only when the server contract already supports it. For Simulation sources,
pricing, basket or checkout, read [search-and-checkout.md](references/search-and-checkout.md).

## Slice checklist

1. **Outcome** — one user-visible path (e.g. “researcher runs X and sees Y”).
2. **Server, when needed** — route/middleware in `server/index.js` or `server/routes/*`.
   Follow the `pyxis-api-route` skill for auth/credits/status codes.
3. **Client, when needed** — route in `client/src/routes.jsx`, screens under `client/src/`,
   HTTP via `API_CONFIG.buildApiUrl()` / `buildUrl()`, auth from
   `client/src/context/auth.jsx`. Do not enforce company role only in the UI.
4. **Verify** — pick one primary harness below; run it. Add a new test only
   when no existing file covers the boundary.
5. **Stop** — do not expand into new billing/tenant features unless asked.

## Gen-test: choose the harness

| Change type | Prefer | Examples |
|-------------|--------|----------|
| Pure server util / contract | `server/test/<name>.test.mjs` | `plan-checkout.test.mjs`, `ssrf-ligand-config.test.mjs` |
| Auth, Stripe webhook, credits, runtime | `server/test/runtime-smoke.test.mjs`, `stripe-webhook.test.mjs` | spawn app + memory Mongo |
| Tenant / simulation log ownership | `server/test/simulation-logs-tenant.test.mjs` | companyId filters |
| Client fetch auth header discipline | `scripts/check-authed-fetch.mjs` | `bun run test:authed-fetch` |
| UI flow / viewer / shell / plans UX | `scripts/check-*-lifecycle.mjs` or `check-*-ux.mjs` | molecule viewer, simulation search, shell, plan, auth-public |
| Branding strings | `bun run test:brand` | |

### When to add a new `server/test/*.mjs`

- New pure function or filter with clear inputs/outputs.
- New webhook/event mapping or credit grant path.
- Copy the small `check`/`test` + `process.exit` style from neighbors;
  wire a `test:<name>` script in `server/package.json` if it should join `test`.

### When to extend a lifecycle / UX script

- Use string/AST checks for structural rules (e.g. missing Authorization).
- Use existing executable lifecycle checks for state transitions; static matches
  do not prove that a real interaction works. Exercise the affected browser path
  when UI behavior is the claim.
- Extend an existing harness before adding another testing platform.

### When not to add a test

- Docs-only or comment-only changes.
- Pure re-exports with no behavior change.

## Commands (smallest convincing)

```bash
bun run check                 # server compile + client build when both sides move
bun run test                  # full server suite when shared middleware moves
# or one of:
bun --cwd=server run test:stripe
bun --cwd=server run test:plans
bun run test:authed-fetch
bun run test:molecule-viewer  # example lifecycle
bun run ci                    # only when blast radius warrants full gate
```

A green `build` alone does not prove a dashboard flow.

## Anti-patterns

- Client-only credit or role checks
- New `fetch('/api/...')` without Authorization (trips logout on 401)
- Treating source-string assertions as proof of a working browser interaction
- Stacking many overlapping smokes for one assertion
---

Simulation search regression: execute rejected-query handlers in `test:simulation-search`; prove old rows clear and catalog browsing cannot run in stock/open mode or during a pending search. Open compounds: `bun run test:open-compounds`.

Molecule basket checkout redirects to the server-created Stripe URL: no client publishable-key guard. Verify the actual navbar handler reaches the authenticated endpoint without VITE_STRIPE_PUBLISHABLE_KEY in `test:catalog-pricing` (checkout re-prices from the original catalog API `GET /api/id/{code}`; stock-origin rows are refused).
