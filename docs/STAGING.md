# Pyxis staging — full app at `/staging/`

**Live 2026-09-24:** `https://app.pyxis-discovery.com/staging/` runs a separate
Pyxis process with the normal production accounts, Atlas data, history, credits,
orders, providers and checkout. This is intentionally **shared read/write
data**: an action in staging can change a real production record or balance.
The consumer app does not link or redirect to `/staging/` and its process,
frontend bundle, and nginx root route were not changed by this switch.

Source commit `acaa4a3`; staging frontend index SHA-256
`c0689418eae7a35d0bffaa7e3e7c4640484b73dc325b4e6165ebf7117cc4c24b`.
Consumer bundle SHA-256 remained
`c215f55254fa45d2ab855589c5ebb4b8a939271ee2f284c5db4871ce07dfddcd`
and `pyxis-web` PID remained `2965854` during the switch. DNS resolved to 84.
Runbook and rollback: [`deploy/staging/README.md`](../deploy/staging/README.md).

## Topology and data scope

| | Consumer app | Staging |
|---|---|---|
| URL | `/` | `/staging/` (no consumer redirect) |
| Host/service | 84 `pyxis-web` `:5174` | 84 `pyxis-web-staging` `127.0.0.1:5274` |
| Tree | `/root/pyxis-LIVE-5174` | `/root/pyxis-STAGING-5274` |
| Frontend | Vite base `/` | Vite base `/staging/`, `noindex` |
| Backend mode | normal | normal + `PYXIS_STAGING_MODE=true` |
| Accounts, Atlas, JWT, Stripe, providers | production | same existing production credentials, read in place |
| Browser session keys | normal same-origin keys | `pxstg__` namespaced keys; sign in again with the same account |
| Simulation stock index | tonomitosql on oracleOld | same dataset and service |
| Macrocycle index | not deployed to consumer app | separate loopback `:8274` on 84 |
| Open compounds AI | disabled on consumer app | OmniRoute free model through private loopback tunnel |

The staging unit reads `/root/pyxis-LIVE-5174/server/.env` **in place**;
credentials are not copied into the staging tree. Its `ExecStart` overrides
the port, bind host, asset path, base URL, staging flags, and AI configuration.
Startup uses the normal Mongo-backed routes. `GET /api/staging/status` reports
`demo:false`, `sharedProductionData:true`, `historyAvailable:true` and live
provider/credit flags; the browser banner uses this server-owned status.
Staging and consumer tokens use the same signing key, while namespaced browser
storage avoids logging out the other tab. Checkout is configured to redirect
back to the `/staging/` URL; payment completion and webhook delivery were not
exercised during this staging release.

This is not a database snapshot or sandbox. Both `pyxis-web-staging` and
`pyxis-macrocycle-search-staging` are enabled at boot, as are the two AI bridge
units on oracleOld. Staging remains reachable only through nginx's existing
`location /staging/` → loopback proxy; no additional public listener or DNS
record was created. `noindex` is a search-engine hint, not access control.

## Simulation sources

- **Internal catalog:** both apps use the existing Asinex supplier API. On
  2026-09-24 `dev.asinex.com:58181` refused TCP connections from Mac, 151 and
  84. DNS resolved to `213.208.173.213`; the Asinex website, stock host and
  docking host remained reachable. This establishes an unreachable catalog
  port, not its internal cause. The supplier must restore it or provide a new
  catalog endpoint. Do not substitute stock/macrocycle rows or invent prices.
- **Stock compounds:** 630,646 compounds available through the same
  tonomitosql service as production; stage browser status verified.
- **Real macrocycles:** 18,171 searchable structures from 18,190 dated export
  rows. **Virtual macrocycles:** 2,347,736 searchable structures from 2,350,440
  export rows. They use an independent read-only Morgan/ECFP4 binary Tanimoto
  index at `127.0.0.1:8274`; no pack prices or cart purchases. Source amounts
  and lead times are dated export fields, not current offers. See
  [`DATA-MACROCYCLES.md`](DATA-MACROCYCLES.md).
- **Open compounds:** ChEMBL retrieval with local RDKit Morgan/Tanimoto
  ranking; AI tool loop is enabled only on staging via
  `openrouter/openrouter/free` through OmniRoute. An explicit **Search without
  AI** path remains available. The public route has no AI configuration. See
  [`DATA-OPEN-COMPOUNDS.md`](DATA-OPEN-COMPOUNDS.md).

The staging frontend opens Simulation on Real macrocycles so the preview is
immediately useful while the external catalog port is down. The consumer build
still opens on Internal catalog. Query controls and results are side by side
at desktop width; drawing, SMILES, and source selection remain available.

## Private AI bridge

`pyxis-open-compounds-ai-proxy.service` on oracleOld binds only
`127.0.0.1:20130`; it injects the existing OmniRoute client key from
`~/.config/omniroute/oracle.env`, accepts only the chemical-search tool and
the verified free model, and forwards to gateway loopback `:20128`. A separate
SSH reverse tunnel exposes it at `127.0.0.1:20129` on 84. The staging app
uses that loopback URL with a non-secret placeholder bearer value. No gateway
key is stored on 84 or sent over the public HTTP gateway. If the bridge is
unavailable, AI search fails visibly; it never silently falls back to the
deterministic path or a paid model.

## Verification, 2026-09-24

- `bun run check`, `bun run test:staging-build`, `bun run
  test:simulation-search` (102 invariants), and `bun --cwd=server run
  test:open-compounds:bun` (35 + 39 + 23 checks) passed; Python proxy compiled.
- Tunnel `/health` answered 200 from 84. A required tool call through the
  tunnel returned `search_similar_open_compounds`. The live AI test on 84
  returned six ChEMBL hits, top `CHEMBL1373993` at similarity 1.000.
- Browser over HTTPS: the former synthetic staging token led to the real
  sign-in page and shared-data banner. The configured production demo account
  signed in and saw 30 existing simulation records. Stock status reported
  630,646 compounds. Open compounds exposed AI search and a browser query
  returned six RDKit-ranked hits with the same exact top match. Plans & Credits
  displayed the normal purchase controls; **no payment or paid science job was
  submitted**.
- Stage loopback `/health` and `/api/staging/status` answered; consumer PID and
  bundle hash stayed unchanged. Earlier browser checks verified both macrocycle
  sources, selection, and virtual pagination to 12 results. The paid provider
  round trips and completed Stripe payment remain untested.

## Rollback and traps

Pre-switch files are at `/root/pyxis-staging-full-rollback-20260924/` on 84:
the original staging unit and `staging-before.tar` (server files, frontend
bundle, docs; **no `.env`**). Restore the original unit and pre-switch bundle,
`systemctl daemon-reload`, restart only `pyxis-web-staging`, and confirm
`/api/staging/status` reports `demo:true`. Disable the full staging unit at
boot if reverting to the older owner-test setup. Stop/disable the two
oracleOld AI bridge units if no longer needed. Do not restart `pyxis-web`,
alter nginx or DNS, or roll back the shared Mongo database for a staging-only
code failure.

The older demo router and its in-process folding/simulation history remain in
source as a reversible fallback. Demo mode used a **different** JWT secret,
fixture folding, and no MongoDB; none of those descriptions apply to the
current full staging service. Keep staging and consumer frontend builds
separate: `bun run build:staging` writes `/staging/` asset URLs, and a normal
`bun --cwd=client run build` must be restored locally before any consumer
artifact is packed. The `401`/`403`/`502` status contract still applies;
staging logout clears only its namespaced browser storage.
