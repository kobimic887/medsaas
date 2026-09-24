# September 2026 macrocycle search

Anna's September 23 email requests two additional Simulation sources. The
published files on `https://spectra.pyxis-discovery.com/CompChem/` differ from
the email's proposed names: `Pyxis_RealStock_18190.csv` has **18,190** source
records and `Pyxis_Virtual_Molecules_20260923.zip` has **2,350,440**. Keep the
dated originals outside Git; the import script checks their headers and exact
row counts. SHA-256 of the originals used for this preview:

| Source | SHA-256 |
|---|---|
| Real CSV | `89760f2de3a4203a9d02f975f1ffe9a266d4e38e5a2e34132ea542157f860fa9` |
| Virtual ZIP | `6e95e69e5a0e1aa470303ef486a3051304b926d9e7a8dadde9ccb9a2c3bb6597` |

Neither source contains a pack price. The listed `web_mg`,
`CURRENT_TOT_NETTO_MG`, and lead times are source metadata, not a current stock
or delivery promise. Macrocycle results are unpriced and cannot enter the cart;
selection is for docking handoff. Real source supplier codes repeat (2,593
repeated rows); each accepted row has its own stable index identity while its
supplier code remains visible. Do not deduplicate by `MAIN_BAS` or use it as
the React selection key.

The completed RDKit index contains **18,171** searchable real structures
(19 invalid SMILES excluded) and **2,347,736** searchable virtual structures
(2,704 invalid SMILES excluded). The import accepted every source record;
invalid structures are preserved in the original export and reported in each
index manifest rather than silently altered.

## Search contract

The two sets are independent of Internal catalog, Stock compounds, and ChEMBL.
`GET /api/macrocycles/status?source=real|virtual` and
`GET /api/macrocycles/similarity?source=...&smiles=...&threshold=...&offset=...&limit=...`
require an authenticated active user. Status reports `available: false` with
a reason when the service/dataset is absent; similarity returns 503
`MACROCYCLE_SEARCH_UNAVAILABLE`. Malformed source or query returns 400. There
is no silent fallback. Search uses RDKit Morgan radius 2, 2048 binary bits,
chirality off, with binary Tanimoto. Count-based MOE ctanimoto was explicitly
excluded from this slice. Results are ranked globally by score, then index row
ID, and paginated. The index manifest records RDKit-rejected structures; they
are excluded from the searchable count shown in the UI.

Staging runs a compact, read-only index in a separate loopback process at
`127.0.0.1:8274` (`pyxis-macrocycle-search-staging`). Its fingerprint record is
266 bytes: metadata CSV byte offset, bit count, and 256 fingerprint bytes.
The service holds no database and does not mutate the existing stock
tonomitosql deployment. `MACROCYCLE_SEARCH_BASE` belongs only to the staging
web service's systemd drop-in; consumer `pyxis-web` is unconfigured. The
staging server proxies the same authenticated API to the loopback service.

## Rebuilding the immutable index

Download the exact source files above into an external data directory, then:

```bash
bun scripts/import-macrocycle-datasets.mjs --source real --input /data/Pyxis_RealStock_18190.csv --out-dir /data/macro-real
bun scripts/import-macrocycle-datasets.mjs --source virtual --input /data/Pyxis_Virtual_Molecules_20260923.zip --out-dir /data/macro-virtual
bun services/macrocycle-index/build.mjs --source real --input /data/macro-real/macrocycles-real-upload.csv --out-dir /data/macro-index
bun services/macrocycle-index/build.mjs --source virtual --input /data/macro-virtual/macrocycles-virtual-upload.csv --out-dir /data/macro-index
```

Inspect both import reports and manifests. The builder rejects a row-count
mismatch or more than 2% invalid SMILES and writes completed files only after
validation. Install the complete `*.fpb`, `*.rows.csv`, and `*.manifest.json`
set into an isolated index directory, then start the loopback unit. See
[`deploy/staging/README.md`](../deploy/staging/README.md) for staging install
and rollback. Index data are artifacts, not source control files.
