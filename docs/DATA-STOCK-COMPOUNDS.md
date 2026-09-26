# Stock compound search

Simulation searches the configured stock dataset through the application API.
Stock, macrocycle, and open-compound results remain separate sources;
an unavailable source never falls back to another one. Stock selection passes
a structure to docking. Eligible rows also carry signed Pyxis shop offers; see
[compound shop](COMPOUND-SHOP.md).

## API and configuration

Both routes require an authenticated, active user:

| Route | Result |
|---|---|
| `GET /api/stock-search/status` | Availability, resolved dataset, and supported methods |
| `GET /api/stock-search/similarity` | Ranked results for `smiles`, `threshold`, `offset`, and `limit` |

The similarity route also accepts `fingerprint_type` and `similarity_metric`.
Defaults are `morgan` and `tanimoto`. The implementation and validation live in
[`server/utils/stockSearch.js`](../server/utils/stockSearch.js).

| Setting | Purpose |
|---|---|
| `STOCK_SEARCH_BASE` | Search service URL; falls back to `TANIMOTO_API_BASE` |
| `STOCK_SEARCH_DATASET_ID` | Optional numeric dataset selection |
| `STOCK_SEARCH_DATASET_NAME` | Dataset discovery by name when an ID is absent |

The browser calls the authenticated application API, not the underlying search
service. Missing configuration or dataset returns `available: false` from
status and `503 STOCK_SEARCH_UNAVAILABLE` from similarity. Invalid queries return
400; upstream failures return 502. A 401 denotes a dead application session.

## Similarity methods

The search service computes RDKit fingerprints from SMILES for both the library
and query. Imported MOE fingerprint columns are preserved in the original data,
but are not used for RDKit comparisons.

| Parameter | Allowed values |
|---|---|
| `fingerprint_type` | `morgan`, `maccs`, `feat_morgan`, `atom_pair`, `torsion`, `rdkit` |
| `similarity_metric` | `tanimoto`, `dice` |
| `threshold` | 0.1–1.0 |

All stock methods use **binary fingerprints**. The UI must label the selected
method accurately; no stock option represents count-based or MOE-equivalent
similarity. See [fingerprint and metric semantics](REFERENCE-STOCK-FP-METRICS.md).

Results have `{ molecule_id, canonical_smiles, similarity, metadata }`. The
response also records the selected method. Ranking must be global—similarity
descending, then engine row ID ascending—before applying offset and limit.
Do not cap candidates before resolving score ties. The client also deduplicates
appended pages by engine row ID.

## Identifiers and display

Keep these values distinct:

- `molecule_id`: engine row identity, used for page deduplication.
- `MAIN_BAS` / `compound_id`: readable stock code.
- `ID`: source identifier, retained as a string to preserve leading zeros.
- `offset`: pagination position, never inferred from a stock code.

Source quantity fields are dated snapshots, not live availability. The mapper in
[`stockResults.js`](../client/src/utils/stockResults.js) does not invent chemical
properties or offers. It preserves server-signed offers from the search response;
the server validates workbook prices and snapshot quantity at checkout. `/api/stock-offers` returns `503 STOCK_OFFERS_DISABLED`.

New or failed searches clear old results and disable stale pagination. The
separate Deep Similarity page can scope searches through its dataset picker;
it is not a replacement for Simulation's stock workflow.

## Import and verification

[`import-stock-compounds.mjs`](../scripts/import-stock-compounds.mjs) accepts the
supported TSV or ZIP export, validates its expected columns, and generates an
upload CSV and reports. Source files and generated data belong outside Git.
Use an isolated, approved search service for import testing:

```bash
bun scripts/import-stock-compounds.mjs \
  --input /data/stock-export.zip \
  --base-url http://127.0.0.1:8000 \
  --name "Stock compounds — example" \
  --out-dir /data/stock-import \
  --verify
```

Review rejected structures and import reports rather than silently repairing
SMILES or dropping duplicate structures with distinct stock codes.

```bash
bun run test:stock-search
bun run test:simulation-search
```

These checks exercise API and UI contracts. Service availability and ranking
against an installed dataset require a separate runtime check. Deployment and
private data locations belong in [operator records](OPERATIONS.md).

The [organized SQL catalog](../services/catalog-sql/README.md) also exposes existing stock and its six stored fingerprint columns alongside RPX/VPX. Retired supplier catalog aliases and legacy molecule checkout return `503 CATALOG_RETIRED` locally; credit-pack purchases are independent and remain supported.
