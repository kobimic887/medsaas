# Search and checkout contracts

Read before changing Simulation sources, similarity metrics, offers, basket or
checkout behavior. These are product constraints; current deployment identity
comes from measured live state and `docs/POST-PROMOTION-HANDOFF.md`.

- Stock-compound similarity lives **in Simulation** (source toggle `Internal
  catalog | Stock compounds | Open compounds`), not the Deep Similarity picker. Server
  `GET /api/stock-search/status|similarity` proxy an internal tonomitosql
  dataset via `STOCK_SEARCH_BASE` / `STOCK_SEARCH_DATASET_ID` /
  `STOCK_SEARCH_DATASET_NAME`; unprovisioned = **503 `STOCK_SEARCH_UNAVAILABLE`**
  (never a silent fallback to Asinex). Stock similarity accepts client
  `fingerprint_type` / `similarity_metric` from the verified binary allowlist
  (defaults `morgan`/`tanimoto`; unknown → **400**); labels mark scores
  **(binary)** — no count/ctanimoto option. Contract:
  `docs/DATA-STOCK-COMPOUNDS.md` (+ `docs/REFERENCE-STOCK-FP-METRICS.md`).
  The September 23 **Real macrocycles** (RPX) and **Virtual macrocycles** (VPX)
  form one staging Simulation Macrocycles collection, with All/Real/Virtual
  filters (`docs/DATA-MACROCYCLES.md`). Their
  authenticated `/api/macrocycles/status|similarity` routes use a separate
  `MACROCYCLE_SEARCH_BASE` and `source=both|real|virtual`; combined search
  globally ranks both indexes, keeps hits with the same SMILES or supplier ID,
  and identifies rows by source plus index row ID. Missing either combined
  dataset returns 503, never catalog/stock results. Staging's compact read-only
  RDKit Morgan index is loopback `:8274`:
  format 1 serves binary Tanimoto, format 2 adds `<source>.cnt` (one byte per set
  bit, ascending) and the count metrics. `similarity_metric` is `tanimoto`
  (default), `count_tanimoto` or `count_dice` (unknown, including the MOE name
  `ctanimoto`, → **400**); a format-1 dataset advertises Tanimoto alone and
  refuses a count metric with 400 before any scan. The count metrics are a Pyxis
  method over RDKit's own Morgan environments (`server/utils/countMorgan.js`) —
  **not MOE ctanimoto, not MOE-comparable**; labels must say "(frequency-weighted)"
  or "(binary)". MOE btanimoto/ctanimoto parity stays unbuilt. Source IDs can
  repeat, so use source plus index row ID for selection. Neither source has
  per-row offers or can enter the cart; source
  amounts/lead times are not verified offers. Staging may show the separate
  `Pyxis-e-shop_PRICE_LIST.xlsx` 1–3 selected-compound euro tier for other
  stock codes, LAS, RPX and VPX as approximate USD amounts beside each staging result;
  it is not a checkout price source without confirmed FX and offer rules.
  The staging build starts Simulation on Pyxis stock; its source picker contains
  stock, combined Macrocycles and ChEMBL, not the failed supplier
  catalog. The consumer build still starts on Internal catalog.
  Open compounds: AI tool loop
  (`POST /api/open-compounds/ai-search`) plus deterministic
  `GET /api/open-compounds/status|similarity|export` — ChEMBL retrieval + local
  RDKit Morgan re-score (`docs/DATA-OPEN-COMPOUNDS.md`); never fall back to
  catalog or stock. Explicit “Search without AI” uses the deterministic path;
  AI failures do not silently run it.
  Full stock contract in `docs/DATA-STOCK-COMPOUNDS.md`. Failed/new searches
  disable pagination and clear old rows; catalog browsing must reject stock/open
  mode so Asinex rows cannot appear as stock/open hits. **Owner decision
  2026-09-13 supersedes the 4b285aa live-quote pricing: the browser never
  prices via `POST /api/stock-offers` or `/api4/bas`.** Stock rows carry workbook
  pack estimates in staging but **no checkout prices** — no Purchase column, no basket adds; selection stays
  docking-handoff only. Internal catalog price columns and basket adds come
  from the catalog's **own browse/search response**: the page normalizer maps
  `PRICE_*MG` / `price_*mg` per row, and a row without a positive pack price
  cannot be added. Measured live 2026-09-13, BAS 00132206 answers $28/$84/$224
  (1/5/10 mg) on `/api/all` browse rows and $170/$194/$218/$242 (1/2/5/10 mg)
  on `/api4/bas` search rows — display what the row's own response carried,
  never a hardcoded amount. Checkout stays server-owned: it re-prices from the
  **original catalog API per compound** — `GET /api/id/{code}` in
  `server/utils/catalogPricing.js` (code = `id_number`, prefix + space intact,
  URL-encoded; rows carry `price_1mg/5mg/10mg`, **no `price_2mg`**; unknown
  code = 200 + empty body → unresolved → 400, never a zero price; upstream
  failure = 502 `CATALOG_PRICING_UNAVAILABLE`). Stock-origin basket rows are
  refused with **400 `MOLECULE_STOCK_ITEMS_UNSUPPORTED`** + `unsupportedItems`
  (navbar removes them and requires a fresh click); legacy baskets without a
  `source` field are catalog rows — absence of `source` never means stock, and
  stock rows are never silently converted into catalog purchases.
  `POST /api/stock-offers` is an explicit refusal: **503 `STOCK_OFFERS_DISABLED`**,
  no upstream call. A changed/absent
  displayed price answers **409 `MOLECULE_PRICES_CHANGED`** with re-priced
  `updatedCartItems` before any Stripe session (navbar persists them and
  requires a fresh checkout click); explicit `quantity` ≠ numeric 1 is a 400 —
  each row is one pack. Hosted Stripe Checkout redirects to the server-created
  URL and must not require `VITE_STRIPE_PUBLISHABLE_KEY` in the browser.
  Staging still refuses `/api/stock-offers`. Upstream `/api4/bas` has **zero
  runtime callers**: BAS-code search keeps the `POST /api/api4/bas` client
  contract but answers from the same `GET /api/id` wrapper
  (`searchCatalogRowsByBasCodes`); because `/api/id` cannot price
  2 mg, catalog display must not offer 2 mg packs from `/api4` search rows.
