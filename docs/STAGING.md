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

- **Legacy Internal catalog:** the consumer app still uses the Asinex supplier
  API. On 2026-09-24 `dev.asinex.com:58181` refused TCP connections from Mac,
  151 and 84. DNS resolved to `213.208.173.213`; the Asinex website, stock host
  and docking host remained reachable. This establishes an unreachable catalog
  port, not its internal cause. Staging's Simulation picker no longer exposes
  this catalog; it searches the Pyxis-owned datasets below. No dated export is
  treated as a verified offer.
- **Stock compounds:** 630,646 compounds available through the same
  tonomitosql service as production; stage browser status verified.
- **Macrocycles:** one combined search over **Real RPX** (18,171 searchable
  structures from 18,190 dated export rows) and **Virtual VPX** (2,347,736
  searchable structures from 2,350,440 export rows), with Real and Virtual
  filters. The combined collection has **2,365,907** searchable rows and keeps
  duplicate structures across subsets as distinct source-labelled hits. They
  use an independent read-only Morgan/ECFP4 index at
  `127.0.0.1:8274`; no pack prices or cart purchases. Source amounts and lead
  times are dated export fields, not current offers. Both deployed artifacts are
  **format 2** and offer binary Tanimoto plus frequency-weighted Count Tanimoto
  and Count Dice (a Pyxis method, not MOE ctanimoto). See
  [`DATA-MACROCYCLES.md`](DATA-MACROCYCLES.md).
- **Open compounds:** ChEMBL retrieval with local RDKit Morgan/Tanimoto
  ranking; AI tool loop is enabled only on staging via
  `openrouter/openrouter/free` through OmniRoute. An explicit **Search without
  AI** path remains available. The public route has no AI configuration. See
  [`DATA-OPEN-COMPOUNDS.md`](DATA-OPEN-COMPOUNDS.md).

The staging frontend opens Simulation on the Pyxis stock index and presents
Stock compounds, combined Macrocycles, and Open compounds as collections.
The consumer build still opens on Internal catalog.
Query controls and results are side by side from desktop width, with a wider
Find compounds panel. Drawing, SMILES, and source selection remain available.
Each Pyxis stock, RPX, or VPX result row displays the matching pack amounts from
the owner's approved **1–3 selected-compound** workbook tier. The EUR amounts
convert to rounded USD estimates at the dated ECB 24 September rate
(1 EUR = 1.1367 USD); they do not price a basket row or verify availability.

### Replacement catalog gaps

The source files now support structure-similarity discovery in staging, but
they do not yet supply a complete independent e-shop catalog:

| Needed for | Current gap |
|---|---|
| Product lookup | Pyxis stock and macrocycle indexes need code/ID lookup, browse, substructure and molecular-weight search; they currently expose similarity only. |
| Buyable offers | The price workbook has prefix/quantity tiers, not a confirmed live offer for each molecule. The user limited it to 1–3 selected compounds; larger tiers are not usable. Current stock, pack availability, delivery commitment and offer validity need a supplier feed or signed rules. |
| USD checkout | The displayed ECB conversion is informational. A server-owned FX source, validity period, rounding, taxes/shipping and re-pricing rule must be approved before creating Stripe sessions. |
| Order fulfillment | The route for sending a paid order to the supplier and receiving confirmation/tracking is not specified or exercised. |
| Scientific data | MOE `btanimoto`/`ctanimoto` parity needs Anna's exact fingerprint definition/version and sample reference vectors; current count metrics are Pyxis/RDKit methods. |

The consumer's legacy catalog browse, BAS lookup and checkout still depend on
Asinex's unavailable `dev.asinex.com:58181` endpoints. Its DiffDock and other
scientific services have separate dependencies; see the deployment/arrival
runbooks for their measured status. A replacement catalog can be built from the
owned exports, but production purchase controls must stay disabled for those
rows until the offer and checkout contract exists.

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

## Staging update, 2026-09-25

Staging source is `04ab46c` with the macrocycle count methods and a clearer
Internal catalog outage message. Its frontend index SHA-256 is
`85e625e9775d2d6eca3c7f93dbcba2621d7bad7efeae26015c7930c606d8f84e`.
Both isolated macrocycle datasets now have format-2 count streams: real has
18,171 searchable rows (1,215,118 count bytes), virtual has 2,347,736
(180,702,401 count bytes). Each new fingerprint and metadata file matched the
previous binary search artifact byte for byte; only counts and manifests were
installed. The staging index advertises all three metrics for each source.
Full-index exact searches found `RPX 202406561` and `VPX 900000001` at score
1.000 under all three metrics. The signed-in staging browser also verified
real and virtual metric choices and exact hits. Open compounds AI returned an
exact ChEMBL result; Internal catalog displayed the supplier connection error.
Focused repository tests and builds passed; no payment or paid docking job was
submitted. The consumer process, source identity `22681ed`, and frontend index
SHA-256 `c215f55254fa45d2ab855589c5ebb4b8a939271ee2f284c5db4871ce07dfddcd`
remained unchanged. Current rollback snapshot is
`/root/pyxis-staging-count-rollback-20260925/` on 84 (`staging-before.tgz`,
`index-before/`, and both saved frontend bundles). Restore those staging-only
files and restart the two staging units if this update must be reversed.

## Pyxis-owned catalog preview, 2026-09-25

Staging runtime source is `cb5e06e`; the served staging frontend index SHA-256
is `499370258435d7584cfbfa9a7eeb1dd409d3fa15f80b7765a0223dad5e494dca`.
The staging-only rollback copy is
`/root/pyxis-staging-catalog-rollback-20260925/staging-source-and-bundle-before.tgz`;
the directory also holds uncompressed earlier bundles and baseline consumer
identity. Restoring that archive into `/root/pyxis-STAGING-5274` and restarting
**only** `pyxis-web-staging` returns to the previous search UI. No index or
shared Atlas data changed in this release.

The signed-in browser showed four separate collection cards and opened on the
630,646-row Pyxis stock index without a catalog request or indefinite browse
spinner. A query using the source structure of `ASN 04188606` returned that
code first at similarity 1.000 and ten stock results in the first page. Real
macrocycles reported 18,171 searchable rows and the RPX guide showed its 1,
2 and 5 mg values in approximate USD. The stock guide showed separate LAS and
other-code values. Browser price controls stayed read-only, and no paid action
or Stripe session was submitted. Staging `/health`, shared-data status and
public HTTPS route answered 200 without redirect. The consumer `pyxis-web`
PID remained `2965854`, its index SHA-256 remained
`c215f55254fa45d2ab855589c5ebb4b8a939271ee2f284c5db4871ce07dfddcd`,
and its root URL answered 200 without redirect. `bun run check`, focused
Simulation and shell checks, and the staging build check passed.

## Inline workbook packs and wider search panel, 2026-09-25

Staging source `f8bb81e` shows the approved 1–3 selected-compound workbook
amounts inside each Pyxis result row, in approximate USD, with the original EUR
amount in the pack tooltip. The Find compounds column is wider and the long
method explanation is collapsed. These are prefix/pack estimates, not a verified
offer or Stripe checkout price. The rollback snapshot is
`/root/pyxis-staging-inline-prices-rollback-20260925.tgz`; restoring it over
`/root/pyxis-STAGING-5274` and restarting **only** `pyxis-web-staging` restores
the previous staging interface. No search index or shared database changed.

The served staging frontend index SHA-256 is
`b4ff384f6578a6069fc768d273fd93e7493cdbd74c2d602efe70b2c071679041`.
Browser exact searches showed BAS 30906909 at 1.000 with about $193/$221/$248,
RPX 202406561 at 1.000 with about $360/$415/$477, and VPX 900000001 at
1.000 with about $455/$523/$601 for 1/2/5 mg. ChEMBL deterministic and AI
searches using `c1ccccc1` each returned CHEMBL277500 at 1.000; the AI path
displayed its explanation. The public `pyxis-web` PID stayed `2965854`, its
frontend SHA stayed `c215f55254fa45d2ab855589c5ebb4b8a939271ee2f284c5db4871ce07dfddcd`,
and the public root and staging URLs both answered 200. No payment or paid
scientific run was submitted.

## Combined RPX + VPX search, 2026-09-25

Staging runtime source `e5e5565` presents one Macrocycles collection with
Real + virtual, Real only and Virtual only filters. Combined searches scan
the two existing read-only indexes with one RDKit query and one globally ranked
result list; matching structures remain separate source-labelled rows with
their own workbook pack estimates. The served staging frontend index SHA-256
is `b0ab3adf1d7a3abf1cc3c1550dfc1b71b351a5345cb91c06907e0aa278a49e77`.
The staging-only rollback archive is
`/root/pyxis-staging-rpx-vpx-rollback-20260925.tgz` and includes the preceding
frontend bundle, relevant source files and search service; no `.env` or index
data are inside. Restore it over `/root/pyxis-STAGING-5274` and restart only
`pyxis-web-staging` and `pyxis-macrocycle-search-staging` if needed.

The signed-in browser reported 2,365,907 searchable Macrocycles and returned
`RPX 202410091` and `VPX 900000003` as two exact hits for the shared structure
in [`DATA-MACROCYCLES.md`](DATA-MACROCYCLES.md). The Real and Virtual filters
each returned only their respective hit; switching filters cleared old rows.
The RPX and VPX rows displayed their respective approximate USD pack amounts.
A direct full-index Count Tanimoto query also returned both at 1.000. Focused
index, Simulation, staging API, count-Morgan and build checks passed. Both
staging services and the public service answered health checks. The public
`pyxis-web` PID remained `2965854`, and its frontend index SHA-256 remained
`c215f55254fa45d2ab855589c5ebb4b8a939271ee2f284c5db4871ce07dfddcd`.
No payment or paid scientific run was submitted.

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
