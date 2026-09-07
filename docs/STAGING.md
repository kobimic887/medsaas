# Pyxis staging — `/staging/` on the live hostname

Status: **owner-test preview, LIVE at `https://app.pyxis-discovery.com/staging/`
since 2026-09-07 (branch `staging/folding-preview` @ `2d32f4a`).** Nothing here
is promoted to production automatically; production behavior changes only
through the scoped `/staging/` nginx routing and the separate staging service.

The **Simulation extension** below is LIVE since 2026-09-07 at commit
`2d32f4a` (owner-approved update of the staging service/tree only — production
`:5174` untouched). Docking/DiffDock on staging are real and billed under the
synthetic demo account.

Verified live over HTTPS on 2026-09-07: `/staging` → `/staging/` redirect,
staging SPA + deep-link refresh (200), `/staging/assets/*` scoped, sample files
served, demo sign-in + validate-token, fixture predict (labelled demo), paid
endpoint refusal (403), unknown `/api` (503); **Simulation live checks**
(2d32f4a): catalog browse + substructure search returning real Asinex rows,
`503 STOCK_SEARCH_UNAVAILABLE`, `simulation-logs []`, unauth 401;
production `/`, `/health`, stock search and `/auth/sign-in` unchanged (no
banner). Interactive/WebGL/mobile keyboard checks and the first billed docking
round-trip remain pending a real-browser visit by the owner.

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
| Folding provider | NVIDIA NIM (real, credited) | server fixture — no outbound |
| Catalog + docking | real (Asinex/NVIDIA) | real (owner-authorized 2026-09-07): live read-only catalog + docking/DiffDock under the synthetic demo account |
| Billing / email / ADMET / other paid | enabled | refused (`403 DEMO_MODE_DISABLED`) |
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
   are read, and `/api/openfold3/predict` is answered by a labelled server
   fixture. Simulation browsing/search proxy the **read-only** Asinex catalog
   and, when the service envs are set (owner-authorized for the synthetic
   account), `/api/simulation` + `/api/diffdock/generate` forward to the real
   docking providers — those cost real money. Everything else paid (checkout,
   billing, MolMIM, `diffdock/generate_file`, ADMET, email, Tanimoto) returns
   `403 DEMO_MODE_DISABLED` even when called by hand. `GET /api/staging/status`
   is the single source of truth the UI reads for demo/history capability.
5. **No database, and no pretending there is one.** Production Atlas is
   off-limits and no separate approved database exists, so the demo keeps saved
   predictions and simulation runs in in-process stores
   (`server/utils/foldDemoStore.js`, `server/utils/demoSimStore.js`). The UI and
   the status endpoint both say history is demo-only and resets on restart.
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

## Simulation on staging (owner-tested with real data)

Simulation is usable end-to-end, mirroring production:

- **Browse + search operate on the live read-only Asinex catalog** the same way
  production proxies it (`server/routes/stagingDemo.js` forwards to
  `ASINEX_API_BASE`): browse pagination (`/api/asinex/all/:page_:size`),
  single-compound and exact-SMILES lookups, and the `/api/api4/{bas,
  structure, substructure, similarity, mw}` search family. Queries are
  forwarded untouched and responses passed through verbatim — no canned hits,
  no invented scores (catalog similarity returns only genuine upstream hits,
  exactly like production).
- **Real docking** (`POST /api/simulation`) and **DiffDock**
  (`POST /api/diffdock/generate`) run against the real providers when
  `ASINEX_DOCKING_API_URL` / `DIFFDOCK_API_URL` (+ `SDF_CONVERTER_URL` for
  SMILES ligands) are set. They are paid calls billed under the synthetic demo
  account — authorized by the owner, but each run costs money. Results and
  coordinate blobs are stored in-process with the same row shape and ownership
  semantics as `simulation_logs`; a repeat run is a free in-memory cache hit
  (no second provider call), mirroring production's dedupe.
- **History** (`GET /api/simulation-logs`) lists the demo account's real runs
  only (Control Panel shows an honest empty state until one exists). Storage is
  in-process and resets on restart — labelled as temporary demo history.
- **Stock-compound search** honestly reports
  `503 STOCK_SEARCH_UNAVAILABLE`: the stock dataset is deployed by the separate
  Simulation stock service and is not provisioned for staging. The UI shows an
  explanatory note and disables that source — never a silent Asinex fallback.
- **Still blocked** with explanatory states (never 503 loops): checkout,
  billing, MolMIM, `diffdock/generate_file`, ADMET and other paid neighbours.

Fixture-verified without any real outbound call in
`server/test/staging-simulation.test.mjs` (39 checks under bun + node).

## Status of integrations

- **Verified:** staging routing + deep-link/API scoping (build checks +
  nginx contract), demo sign-in, fixture predict (PDB + mmCIF), viewer-test
  sample files, private folding history lifecycle + privacy negatives + size
  limits (`server/test/staging-demo.test.mjs`, 57 checks), Simulation
  catalog/search/artifacts/docking-lifecycle + refusals against fixture
  upstreams (`server/test/staging-simulation.test.mjs`, 39 checks), cross-secret
  token rejection, paid-endpoint refusal.
- **Unverified by design:** any real NVIDIA folding prediction (fixture only),
  real docking/DiffDock round-trips against the live providers (fixture-verified
  server-side; needs the owner's browser on `/staging/` and costs money),
  persistent history across staging restarts (no isolated DB approved yet),
  browser-rendered Molstar evidence (needs a real browser visit to `/staging/`).

## Common traps

- `client/dist` after `bun run build:staging` is the **staging** build. Always
  restore the production build (`bun --cwd=client run build`) before packing
  anything for the live tree, or a “prod” deploy would ship `/staging/` assets.
- Production `pyxis-web` runs on `0.0.0.0:5174`; the staging unit must keep
  `BIND_HOST=127.0.0.1`. Never flip the staging unit to public.
- nginx `sites-enabled/app.pyxis-discovery.com` is a symlink to `sites-available`.
  Back up/restore file CONTENT (`cat >` / `cat … >`), never `cp -a` (it copies
  the symlink and tracks the live file — real backups carry `.original`/`.current`
  suffixes under `/root/`).
- The demo store resets on restart — don’t “fix” that by pointing staging at
  production Atlas.
- `401` on staging still means dead session only (client logout is namespaced,
  so it cannot log out a production session in another tab).
