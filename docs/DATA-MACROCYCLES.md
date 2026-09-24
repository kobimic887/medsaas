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
is no silent fallback. Search uses RDKit Morgan radius 2, 2048 bits, chirality
off. The default metric is binary Tanimoto over those bits; a **format-2** index
also offers the frequency-weighted **Count Tanimoto** and **Count Dice**
(denominators in `server/utils/countMorgan.js`, Anna's ctanimoto formula
`Σxy / (Σx² + Σy² − Σxy)` and `2Σxy / (Σx² + Σy²)`).

`similarity_metric` accepts `tanimoto` (default), `count_tanimoto` or
`count_dice`; anything else — including the MOE name `ctanimoto` — is a 400, and
`fingerprint_type` accepts `morgan` alone. The count metrics are a **Pyxis
method computed over RDKit's own Morgan environments; they are not MOE
ctanimoto and their scores are not comparable with MOE numbers.** Anna's MOE
btanimoto/ctanimoto parity stays unbuilt and blocked on the fingerprint questions
in [`REFERENCE-STOCK-FP-METRICS.md`](REFERENCE-STOCK-FP-METRICS.md). Count
metrics are offered by these two macrocycle sources only — Stock compounds
remains binary-only.

A dataset whose index is still format 1 advertises Tanimoto alone and refuses a
count metric with 400 before any scan, so no client can ask for a ranking the
artifact cannot produce. Results are ranked globally by score, then index row ID,
and paginated. The index manifest records RDKit-rejected structures; they are
excluded from the searchable count shown in the UI.

Staging runs a compact, read-only index in a separate loopback process at
`127.0.0.1:8274` (`pyxis-macrocycle-search-staging`). Its fingerprint record is
266 bytes: metadata CSV byte offset, bit count, and 256 fingerprint bytes. A
format-2 artifact adds the packed counts file described below, so the count
metrics score in the same bit space without an offset table and without parsing
a structure during the scan. `GET /v1/datasets` reports each dataset's
fingerprint type and available `metrics`.
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
validation. Install the complete `*.fpb`, `*.rows.csv`, `*.cnt`, and
`*.manifest.json` set into an isolated index directory, then start the loopback
unit. See [`deploy/staging/README.md`](../deploy/staging/README.md) for staging
install and rollback. Index data are artifacts, not source control files.

### The format-2 count stream

The builder emits `<source>.cnt`: for each indexed row in index order, one byte
per **set bit** of that row's fingerprint, in ascending bit order, holding the
frequency of the retained RDKit Morgan environment for that bit (capped at 255).
A row's slice length is therefore its stored set-bit count, so the scan reads the
stream in step with the fingerprint records. Sizes are small — roughly the mean
set-bit count per row — and the whole stream is validated against the manifest
before the service accepts the artifact.

Two invariants are enforced while building, and both abort the build rather than
publish something weaker:

- **Support equality.** The set bits of the count vector must equal the set bits
  of the RDKit binary Morgan fingerprint stored in the same record. That is the
  check that keeps the hand-written Morgan replica
  (`server/utils/countMorgan.js`) from drifting; see
  `server/test/count-morgan.test.mjs` for the same assertion against RDKit at
  test time.
- **No isotope-labelled rows.** RDKit's connectivity invariant carries a
  `deltaMass` term; the count invariant floors it at 0, which is exact for every
  unlabelled atom and not guaranteed for a labelled one. A row carrying an
  isotope label fails an explicit build guard with that explanation, so the artifact
  never silently mixes two invariant definitions. An isotope-labelled *query*
  is refused with 400 for a count metric for the same reason; binary Tanimoto
  remains available for that query.

A format-1 artifact stays valid and searchable without a counts file. Both
corpora deployed to `/staging/` on 2026-09-25 are format 2, so both advertise
all three metrics. The consumer app has no macrocycle index configuration.

## Not in this slice (open items from the September email)

These were requested or implied by the email thread and are **not built**. Do
not describe any of them as done, and do not approximate them from nearby data.

- **MOE parity** for `btanimoto` (~30 hits) and `ctanimoto` (~2000 hits). Pyxis
  now ships its own frequency-weighted count metrics for these two sources (see
  the search contract above), but they are computed over RDKit's Morgan
  environments in RDKit's own 2048-bit space. MOE's fingerprint, hash space and
  version remain unknown, an RDKit-query × MOE-library comparison is impossible
  and forbidden, and no label may claim MOE equivalence or reproduce her hit
  counts. Blocked on Anna answering the fingerprint/version questions in
  [`REFERENCE-STOCK-FP-METRICS.md`](REFERENCE-STOCK-FP-METRICS.md).
- **Prices, pack sizes, basket adds, and lead-time promises for the new sets.**
  Neither dated export carries a pack price, so there is nothing honest to
  display. Macrocycle source amounts and lead times are dated export fields,
  not current offers. Stock rows also stay unpriced (owner decision
  2026-09-13). Price columns and basket adds exist only for Internal catalog
  rows, priced from that row's own response and re-priced at checkout.
- **The Asinex catalog port itself.** `dev.asinex.com:58181` refused TCP
  connections from Mac, oracleOld and 84 on 2026-09-24 while its DNS and web/
  stock/docking hosts answered. This is an external outage the supplier must
  clear or replace; do not substitute catalog, stock, or macrocycle rows for it.
- **"New website functionality"** mentioned for the following days was never
  specified beyond the Simulation layout. Nothing was inferred from the mockup
  other than the query/results side-by-side layout.
