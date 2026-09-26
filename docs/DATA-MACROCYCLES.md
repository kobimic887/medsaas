# Macrocycle search

Simulation's Macrocycles collection combines real and virtual datasets, with
All, Real, and Virtual filters. The datasets remain distinct from stock
and ChEMBL sources. Rows support docking handoff and signed Pyxis shop offers.
Source quantities and lead times remain dated snapshots; virtual packs are made
to order. See [compound shop](COMPOUND-SHOP.md).

## API contract

`GET /api/macrocycles/status` and `GET /api/macrocycles/similarity` require an
authenticated, active user. Both accept `source=both|real|virtual`. Similarity
also accepts `smiles`, `threshold`, `offset`, `limit`, `fingerprint_type`, and
`similarity_metric`.

[`macrocycleSearch.js`](../server/utils/macrocycleSearch.js) owns the application
contract. `MACROCYCLE_SEARCH_BASE` selects the index service; each source can be
configured with `MACROCYCLE_REAL_DATASET_ID` / `MACROCYCLE_VIRTUAL_DATASET_ID` and
the corresponding `_DATASET_NAME` settings.

- Missing service or dataset: status reports `available: false`; similarity
  returns `503 MACROCYCLE_SEARCH_UNAVAILABLE`.
- Malformed source, query, or unsupported method: 400.
- Combined search requires both datasets and advertises only their common
  methods. It never substitutes results from another collection.

## Methods and row identity

The fingerprint is RDKit Morgan, radius 2, 2048 bits, chirality off.
`fingerprint_type` accepts only `morgan`.

| Index | Supported `similarity_metric` values |
|---|---|
| Format 1 | `tanimoto` (default, binary) |
| Format 2 | `tanimoto`, `count_tanimoto`, `count_dice` |

A format-1 dataset rejects a count metric before scanning. The name `ctanimoto`
is not an accepted alias. Count methods use RDKit's own Morgan environments;
they do not reproduce MOE scores. Labels distinguish binary from
frequency-weighted similarity. See [metric semantics](REFERENCE-STOCK-FP-METRICS.md).

Combined results rank by score descending, Real before Virtual for ties, then
index row ID, before pagination. Identity is **source plus index row ID**.
Supplier codes and SMILES may repeat within or across sources; do not use them
as unique selection keys or deduplicate records on that basis.

## Building the index

The importer validates the supported export schema and expected row counts.
Keep original exports, checksums, and generated artifacts outside Git. Given
approved source files:

```bash
bun scripts/import-macrocycle-datasets.mjs --source real --input /data/real.csv --out-dir /data/macro-real
bun scripts/import-macrocycle-datasets.mjs --source virtual --input /data/virtual.zip --out-dir /data/macro-virtual
bun services/macrocycle-index/build.mjs --source real --input /data/macro-real/macrocycles-real-upload.csv --out-dir /data/macro-index
bun services/macrocycle-index/build.mjs --source virtual --input /data/macro-virtual/macrocycles-virtual-upload.csv --out-dir /data/macro-index
```

Review import reports and manifests. Invalid SMILES are excluded from the
searchable index and reported; the builder rejects a row-count mismatch or
more than 2% invalid structures. Install the completed fingerprint, metadata,
manifest, and—when format 2—count files together.

Format 2 adds `<source>.cnt`: one byte per set fingerprint bit, in ascending bit
order, storing its retained Morgan-environment frequency, capped at 255. The
scanner consumes counts alongside each fingerprint record. Before publishing,
the builder requires the count vector's nonzero positions to exactly match
RDKit's binary fingerprint.

Isotope-labelled rows fail the count-index build guard because the replicated
connectivity invariant is not qualified for them. Count queries with isotope
labels return 400; binary Tanimoto remains available for such queries.

```bash
bun run test:macrocycle-index
bun run test:count-morgan
bun run test:simulation-search
```

Index deployment and private dataset provenance belong in
[operator records](OPERATIONS.md). The index is read-only and has no application
database.

## SQL inspection

The [organized SQL catalog](../services/catalog-sql/README.md) retains every normalized RPX/VPX source row, including rows excluded from search, and copies the existing binary/count vectors exactly. The `pyxis_catalog` views expose combined inventory, individual sources and calculation formulas alongside existing stock. This is independent of supplier APIs and does not change the configured application search backend.
