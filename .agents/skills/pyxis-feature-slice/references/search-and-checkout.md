# Search and checkout contracts

Read before changing Simulation sources, similarity metrics, offers, basket or
checkout. Runtime identity comes from measured state and the private operator
record described in `docs/OPERATIONS.md`.

## Owned compound sources

Simulation starts on Pyxis stock in every build and offers Stock, Macrocycles,
and Open compounds. Sources never silently fall back to each other or to a
supplier. Failed/new searches clear old rows and disable stale pagination.
Retired catalog browsing cannot run from an owned source.

Result previews render the exact SMILES locally with the shared lazy RDKit loader;
do not look up proprietary structures in PubChem or change their SMILES on failure.
Macrocycle identifiers and SMILES open the preview on hover or keyboard focus.

- **Stock:** authenticated `GET /api/stock-search/status|similarity` uses the
  configured tonomitosql dataset (`STOCK_SEARCH_BASE`, `STOCK_SEARCH_DATASET_ID`
  or `STOCK_SEARCH_DATASET_NAME`). Missing configuration/dataset returns
  `503 STOCK_SEARCH_UNAVAILABLE`. The verified binary fingerprint/metric
  allowlist defaults to Morgan/Tanimoto; unsupported inputs return400. Labels
  say binary; stock offers no count/MOE-equivalent method. Selection is for
  docking handoff. See `docs/DATA-STOCK-COMPOUNDS.md` and
  `docs/REFERENCE-STOCK-FP-METRICS.md`.
- **Macrocycles:** RPX and VPX form one collection with All/Real/Virtual filters.
  Authenticated `/api/macrocycles/status|similarity` uses
  `MACROCYCLE_SEARCH_BASE` and `source=both|real|virtual`. Combined results rank
  globally and preserve duplicate SMILES/codes; identity is source + index row
  ID. Missing either required dataset returns503. Format1 serves binary
  Tanimoto; format2 adds packed counts for `count_tanimoto` and `count_dice`.
  Unsupported metrics, including `ctanimoto`, return400 before scanning.
  Count scores are a Pyxis method over RDKit Morgan environments, **not MOE
  ctanimoto or MOE-comparable**. Labels distinguish binary/frequency-weighted.
  See `docs/DATA-MACROCYCLES.md` and `server/utils/countMorgan.js`.
- **Open compounds:** authenticated deterministic status/similarity/export and
  AI search retrieve ChEMBL candidates then re-score locally with RDKit Morgan.
  “Search without AI” explicitly chooses the deterministic path; AI errors do
  not silently switch modes. See `docs/DATA-OPEN-COMPOUNDS.md`.

## No supplier catalog dependence

`server/utils/catalogAccessPolicy.js` retires supplier catalog namespaces and
aliases for all methods, independently of environment or company overrides.
Legacy `/api/asinex/*`, `/api/api4/*`, `/api/all`, `/api/id`, `/api/exact`,
`/api/shop` and `/api4/*` return authenticated `503 CATALOG_RETIRED` locally.
Demo mode enforces the same policy. Do not restore an Asinex fallback.

Control Panel and Molstar do not fetch supplier prices or invent missing prices.
The legacy pricing utilities/fixtures may remain for historical contract tests;
they are not an active offer source or a route around retirement.

Known Asinex scientific URLs are refused locally. Configured Pyxis compute
alternatives remain supported; do not change company records or automatically
substitute providers. A retired provider refusal must not consume credits.

## Offers and checkout

Stock, RPX and VPX search responses mint signed 24-hour offers from trusted engine
rows. The browser cannot mint offers or supply authoritative prices. ChEMBL stays
discovery-only. `shared/compoundPriceBook.js` owns the workbook's 1–3 tier and fixed
EUR→USD conversion; at most three distinct source/row identities per order. Known
stock/real snapshot mg bounds pack sizes and aggregate basket quantity. Virtual
compounds are made to order. Missing pack prices or quantities never invent stock.

`/api/compound-shop` requires Mongo, JWT and an active user. `/quote` verifies offer
signatures and calculates integer cents. `/checkout` repeats validation and requires
an explicit matching total/version; mismatch returns409 for review. Stripe uses
immediate card capture, listed USD prices include shipping, and checkout collects
billing/shipping addresses. The persisted order and Stripe idempotency key prevent
retries from creating duplicate sessions. Preserve exact request snapshots.

Verified Stripe webhooks and server-side Stripe retrieval can mark orders paid;
URL parameters cannot. Compound payments never grant simulation credits. Order
history is scoped to username and company. Paid does not mean fulfilled. Clear only
the exact purchased cart entries after verified payment; cancellation/failure keeps
the basket. See `docs/COMPOUND-SHOP.md` for policy, tests and fulfillment limitations.

Legacy molecule checkout (including old baskets and description/amount shape)
returns `503 CATALOG_RETIRED` locally; `/api/stock-offers` remains disabled. The
independent known-plan branch uses `buildPlanCheckoutSessionParams` for one-time
credit purchases, fulfilled only through its existing verified Stripe webhook.
Never restore supplier repricing. Ship the shared price module with the server.

Run `test:compound-shop` for offers, real HTTP checkout, verified webhooks and cart
state; `test:catalog-pricing` for retired paths/zero supplier calls and unchanged
credit plans; `test:simulation-search` for source transitions. Exercise the browser
search → pack → cart → review → checkout → order path without a real test charge.

## SQL inspection

`services/catalog-sql/README.md` describes additive `pyxis_catalog`: stock views,
all RPX/VPX source rows, exact copied binary/count vectors, excluded rows and
calculation formulas. Browsing and pair scoring require no supplier API.

This schema does not change application search routing. Keep macros out of public
`molecules`/`fingerprints`, whose default search spans public datasets. Macro
source row numbers include excluded rows and differ from search index IDs;
supplier code and SMILES are not unique. Stock Morgan is512bits, macro Morgan
2048bits; do not directly compare these stored vectors across sources.

RPX/VPX SQL and derived index data reside on the scientific data host. The staging
application uses a private SSH-forwarded loopback endpoint, not a local dataset.
Deploy source/index artifacts only to the data host; keep rollback copies off
the application host too. See `deploy/staging/README.md` for unit roles.
