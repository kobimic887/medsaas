# Search and checkout contracts

Read before changing Simulation sources, similarity metrics, offers, basket or
checkout. Runtime identity comes from measured state and the private operator
record described in `docs/OPERATIONS.md`.

## Owned compound sources

Simulation starts on Pyxis stock in every build and offers Stock, Macrocycles,
and Open compounds. Sources never silently fall back to each other or to a
supplier. Failed/new searches clear old rows and disable stale pagination.
Retired catalog browsing cannot run from an owned source.

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

Source quantities/lead times are dated snapshots, not verified sale offers.
The workbook uses only the 1–3 selected-compound euro tier; its approximate USD
pack estimates are informational until a server-owned offer/FX policy is agreed.
Neither stock, RPX, VPX nor ChEMBL can enter an authorized molecule checkout.
`POST /api/stock-offers` stays `503 STOCK_OFFERS_DISABLED`, without upstream calls.

Molecule checkout (including old baskets and the legacy description/amount
shape) returns `503 CATALOG_RETIRED` before contacting a supplier or Stripe.
The independent known-plan branch stays available and uses
`buildPlanCheckoutSessionParams` for one-time credit purchases. Credits are still
fulfilled only through the verified Stripe webhook. Preserve plans, balances,
orders and historical billing records; retirement is not a billing rewrite.

Verify route retirement/zero supplier calls and unchanged credit-plan checkout
with `test:catalog-pricing`; UI refusal/persistence with `test:catalog-ui`; source
state transitions with `test:simulation-search`. The browser must keep saved
baskets on an unavailable response and must not redirect to payment.

## SQL inspection

`services/catalog-sql/README.md` describes additive `pyxis_catalog`: stock views,
all RPX/VPX source rows, exact copied binary/count vectors, excluded rows and
calculation formulas. Browsing and pair scoring require no supplier API.

This schema does not change application search routing. Keep macros out of public
`molecules`/`fingerprints`, whose default search spans public datasets. Macro
source row numbers include excluded rows and differ from search index IDs;
supplier code and SMILES are not unique. Stock Morgan is512bits, macro Morgan
2048bits; do not directly compare these stored vectors across sources.
