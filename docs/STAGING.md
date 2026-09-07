# Pyxis staging — `/staging/` on the live hostname

Status: **owner-test preview, deployed only to staging.** Nothing here is
promoted to production automatically; production behavior changes only through
the scoped `/staging/` nginx routing and the separate staging service.

Runbook and files: [`deploy/staging/README.md`](../deploy/staging/README.md).
Branch: `staging/folding-preview`.

## What it is

A second, isolated Pyxis application process on the same host and hostname:
`https://app.pyxis-discovery.com/staging/`. nginx routes only `/staging/` to a
loopback staging server (`127.0.0.1:5274`); every other path still goes to the
production app (`:5174`) exactly as before.

| | Production | Staging |
|---|---|---|
| URL | `/` | `/staging/` |
| Service / port | `pyxis-web`, `:5174` (0.0.0.0) | `pyxis-web-staging`, `127.0.0.1:5274` |
| Tree on 84 | `/root/pyxis-LIVE-5174` | `/root/pyxis-STAGING-5274` |
| Frontend build | `vite build` (base `/`) | `vite build --mode staging` (base `/staging/`) |
| Mode | normal | `PYXIS_DEMO_MODE=true` |
| Database | MongoDB Atlas (production) | **none** — in-process demo store |
| Provider calls | NVIDIA NIM (real, credited) | server fixture — no outbound |
| Billing / email | enabled | refused (`403 DEMO_MODE_DISABLED`) |
| JWT secret | production secret | **separate** staging secret |

## Isolation contract

These are enforced by code + config, not by convention:

1. **No request escapes the staging scope.** Every URL the staging build emits —
   API calls, iframe assets, samples — is derived from the Vite base path
   (`/staging/`): `getApiBaseUrl()` returns the base, `withAppBase()` prefixes
   literals, React Router uses it as `basename`, and nginx strips the prefix to
   the staging server. A staging API request can never silently hit the
   production API: unknown `/api/*` paths on the staging server answer
   `503 DEMO_MODE_UNAVAILABLE` instead of falling through.
2. **Same-origin storage is namespaced.** The staging build installs a
   transparent localStorage/sessionStorage prefix (`pxstg__`) at bootstrap
   (`client/src/utils/storageNamespace.js`). Staging logout clears only staging
   keys; production sessions and viewer results in other tabs are untouched.
   The production build installs nothing, so production keys are unchanged.
3. **Separate signing secrets.** Staging runs with its own `JWT_SECRET`. A
   token signed by the production secret is a dead session (401) on staging and
   vice versa — no cross-authentication in either direction.
4. **Demo mode is server-controlled.** `PYXIS_DEMO_MODE=true` changes the
   server, not just the UI: no Mongo client is created, no Stripe/NVIDIA keys
   are read, paid/outbound endpoints (checkout, billing, MolMIM, DiffDock,
   simulation, email, Tanimoto) return `403 DEMO_MODE_DISABLED` even when
   called by hand, and `/api/openfold3/predict` is answered by a labelled
   server fixture. `GET /api/staging/status` is the single source of truth the
   UI reads for demo/history capability.
5. **No database, and no pretending there is one.** Production Atlas is
   off-limits and no separate approved database exists, so the demo keeps saved
   predictions in an in-process store (`server/utils/foldDemoStore.js`). The
   UI and the status endpoint both say history is demo-only and resets on
   restart.
6. **Noindex is not access control.** The staging build injects
   `<meta name="robots" content="noindex,nofollow">`; access control is the
   separate staging sign-in.

## Folding history contract (demo store)

Predictions are private to the submitting user; company membership alone does
not grant access. The demo store implements the conjunctive owner filter
(`server/utils/foldHistory.js`):

```
ownerUserId       === requester user id
AND ownerCompanyId === requester company (null when the user has none)
```

This deliberately differs from the OR-based `simulation_logs` tenant filter
(`server/utils/simulationLogs.js`), which exists for legacy dual-shape rows and
is **not** reused for folding history. Non-owners get a uniform 404 (no
existence oracle). List rows are small projections (no coordinate blobs);
coordinates download through the owning run (`GET /api/folding-history/:id/blob/:i`);
blob sizes and run totals are capped; a failed save persists nothing; a
successful prediction whose save fails stays fully usable with a truthful
warning (never “rerun to save”).

## Demo provider fixture

`server/utils/foldFixture.js` generates placeholder PDB/mmCIF coordinates in
the documented NVIDIA envelope (`outputs[].structures_with_scores[].structure`)
that the shared normalizer (`client/src/utils/openfold.js`) already extracts.
Fixtures are deterministically built from chain lengths, contain **no
confidence scores**, and are labelled `_pyxisDemo: true` so the UI marks them
“DEMO OUTPUT — NOT A REAL PREDICTION”. Sample structures for viewer testing are
real public coordinates (RCSB PDB 1CRN, crambin — `client/public/folding-samples/`)
labelled as examples with provenance, never as new predictions.

## Status of integrations

- **Verified:** staging routing + deep-link/API scoping (build checks +
  nginx contract), demo sign-in, fixture predict (PDB + mmCIF), viewer-test
  sample files, private history lifecycle + privacy negatives + size limits
  (server suite `server/test/staging-demo.test.mjs`, 56 checks), cross-secret
  token rejection, paid-endpoint refusal.
- **Unverified by design:** any real NVIDIA prediction (requires separate owner
  authorization + a real keyed call), persistent history across staging
  restarts (no isolated DB approved yet), browser-rendered Molstar evidence
  (needs a real browser visit to `/staging/`).

## Common traps

- `client/dist` after `bun run build:staging` is the **staging** build. Always
  restore the production build (`bun --cwd=client run build`) before packing
  anything for the live tree, or a “prod” deploy would ship `/staging/` assets.
- Production `pyxis-web` runs on `0.0.0.0:5174`; the staging unit must keep
  `BIND_HOST=127.0.0.1`. Never flip the staging unit to public.
- The demo store resets on restart — don’t “fix” that by pointing staging at
  production Atlas.
- `401` on staging still means dead session only (client logout is namespaced,
  so it cannot log out a production session in another tab).
