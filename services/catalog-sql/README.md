# Organized compound SQL catalog

`schema.sql` adds a `pyxis_catalog` schema alongside the existing scientific
PostgreSQL tables. It organizes locally held supplier exports and their stored
calculations; browsing and pair scoring make no supplier API calls.

## Browse in a database client

Connect to the scientific PostgreSQL database using the private operator access
settings, refresh schemas, then open **pyxis_catalog → Views**. Start with:

| View | Contents |
| --- | --- |
| `collections` | Source counts, dates, manifests; older datasets labelled legacy |
| `compounds` | Combined stock, RPX and VPX inventory, with source labels |
| `stock` | Existing stock rows and original metadata |
| `rpx` / `vpx` | All real / virtual source rows and readable calculated vectors |
| `macrocycles` | Both macrocycle collections together |
| `stock_fingerprints` | Six existing stock vectors in hex, with actual dimensions |
| `calculation_methods` | Calculation names, formulas and limitations |
| `data_dictionary` | Meanings and identities of fields |

```sql
SELECT source, collection_name, source_rows, indexed_rows, excluded_rows
FROM pyxis_catalog.collections;
SELECT * FROM pyxis_catalog.rpx ORDER BY source_row_number LIMIT 50;
SELECT * FROM pyxis_catalog.vpx ORDER BY source_row_number LIMIT 50;
SELECT * FROM pyxis_catalog.calculation_methods;
SELECT * FROM pyxis_catalog.macrocycle_pair_scores('real', 1, 'virtual', 1);
```

Use limited queries while browsing. The combined inventory contains millions of
rows; exporting every decoded fingerprint array is substantially more work.
`macrocycle_records` holds the compact raw bytes, and `imports` holds checksums
and original manifests. Views decode arrays only when selected.

## Identity and calculations

- Identity is `(source, source_row_number)`, including invalid/unindexed source
  rows. Supplier IDs, compound codes and SMILES are **not unique**.
- `index_row_id` is the separate existing search identity; it is NULL for an
  excluded row. Such rows remain visible with `searchable = false`.
- Pair scoring takes **source row numbers**, not index IDs. Missing or excluded
  rows produce an error instead of an invented score.
- Macrocycle vectors are copied exactly: 2048-bit Morgan radius 2, plus packed
  frequencies in ascending set-bit order. `morgan_bit_indexes[i]` pairs with
  `morgan_frequencies[i]`.
- Existing stock Morgan/Feature Morgan vectors are 512 bits. Do not directly
  compare them with macrocycle vectors or assume identical search scores.
- Count Tanimoto is `dot(a,b)/(dot(a,a)+dot(b,b)-dot(a,b))`; count Dice is
  `2*dot(a,b)/(dot(a,a)+dot(b,b))`. These are the existing Pyxis calculations,
  **not MOE ctanimoto**. Binary Tanimoto uses set intersection / union.
- Source amounts and lead times retain their dated-export meaning. This schema
  does not infer current stock, sellable packs, prices or checkout authority.

The application search routes still use their configured search services.
Adding this inspection schema does not switch the macrocycle search backend.
The public scientific tables and their existing default search are untouched.

## Import and verification

Requires PostgreSQL 14+ and the existing RDKit stock tables. No new grants or
credentials are installed. Resolve the host/database and capture the baseline
and rollback privately according to [Operations](../../docs/OPERATIONS.md).

1. Check capacity; reserve at least 3 GiB throughout. Avoid copying large source
   archives onto the database host. Keep original source and index artifacts.
2. Run `schema.sql` in one transaction with `ON_ERROR_STOP`. It intentionally
   fails if `pyxis_catalog` already exists; it is not an overwrite migration.
3. Run `export_index.py --source real|virtual --normalized SOURCE.csv
   --index-dir INDEX_DIR`. Its NDJSON output includes every original normalized
   row, exact indexed vectors, artifact hashes, and a mandatory checksum footer.
4. Stream that output (optionally gzip it for transport) to `import_stream.py
   --apply --exported-at YYYY-MM-DD` in the existing scientific API runtime,
   which supplies psycopg and its private DB settings (set `PYTHONPATH` to its
   application directory when executing a script outside that directory). Import one source at a
   time. Each commits atomically after full validation; duplicate imports fail.
5. Check collection totals, excluded rows, stored vectors and pair scores;
   analyze the new table and confirm existing stock search health.

A failed COPY transaction can leave allocated dead space even after rollback.
Do not repeatedly retry a large failed import without reclaiming that space.
When abandoning this wholly additive installation, dropping only the newly
created `pyxis_catalog` schema removes its relations and reclaims their storage.
Never drop or alter the existing public tables as part of that rollback.

```sh
python3 services/catalog-sql/test_stream.py
```

`test_schema.sql` exercises byte order, scores, excluded rows and constraints.
Run it **after schema.sql within a transaction that is rolled back**, against a
compatible database where this schema does not already exist. It is not a test
fixture to insert into an installed catalog.

`verify_import.py --stream EXPORT.ndjson.gz` and `verify_import.py --database
real|virtual` calculate the same full-row digest, including source data and exact
vectors. Run the database mode in the scientific API runtime and compare both
JSON results. It uses a bounded, read-only server cursor. The legacy SQL_ASCII
database stores UTF-8 bytes; the importer explicitly uses UTF-8 and nonescaped
Unicode JSON, without changing the shared database encoding.
