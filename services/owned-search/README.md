# Owned source graph and identifier search

The authenticated application exposes `POST /api/owned-search` and
`GET /api/owned-search/status?source=stock|both|real|virtual|open`. These routes
never use the retired supplier catalog namespaces.

A request selects one source and `id`, `exact`, `substructure` or `similarity`,
with 1–20 query strings, `offset` 0–900 and `limit` 1–100. Similarity additionally
accepts the existing source-specific fingerprint/metric and threshold options.
Each query is reported as matched, unmatched or invalid. Responses preserve
source plus index row identity, duplicate codes/structures, matching query indexes,
trusted signed offers for stock/RPX/VPX, and discovery-only ChEMBL records.

Batch results are a deterministic union; similarity takes the maximum score across
queries and uses source/row identity to break ties. Each query retrieves at most
1000 ranked records; capped counts are lower bounds (`totalExact=false`,
`truncated=true`). `hasMore` refers to the bounded union and stops at the 1000-row
boundary. A timeout or provider failure fails the whole request rather than
returning a silently incomplete source. Invalid chemistry is a per-query error.
The aggregate request budget is 90 seconds, with at most 40 seconds per provider
request and each provider request bounded by the remaining aggregate budget.

## Chemistry

- Exact search compares RDKit canonical isomeric chemistry, retaining charge,
  isotope and stereochemistry. It is not fingerprint similarity at threshold 1.
- Stock uses the existing PostgreSQL RDKit cartridge in a read-only transaction,
  limited to the resolved stock dataset. Identifier fields are `ID`, `MAIN_BAS`
  and `compound_id`; exact IDs are text, so leading zeros and spaces survive.
- Macrocycle ID/exact/graph searches use an additive immutable screen over the
  **existing indexed rows**, not excluded source rows or a different database.
  IDs are exact original `ID`/`MAIN_BAS` codes. Canonical hashes and ID hashes are
  verified against the full row; hash collisions cannot become false positives.
- Macrocycle substructure uses RDKit PatternFingerprint as a necessary screen,
  followed by actual `HasSubstructMatch(..., useChirality=True)`. Morgan bits are
  never used as a graph screen. Stock and macrocycles accept SMILES/SMARTS.
- Open compounds uses official ChEMBL ID/structure/substructure APIs, then
  verifies exact canonical chemistry or substructure/chirality locally. ChEMBL
  substructure requires SMILES; arbitrary SMARTS is refused for that source.
  Query structures are sent to ChEMBL. Retrieved candidates are bounded, and
  their reported retrieval cap is preserved. Open similarity keeps the existing
  local Morgan re-score among retrieved ChEMBL candidates.

## Scientific artifacts and staging isolation

`build.py` creates `<source>.graph` (304 bytes per indexed row) and a completion
manifest without copying the source CSV or modifying any existing index. Each
record holds three 128-bit SHA-256 prefixes (canonical chemistry, compound code,
source ID) and a 2048-bit PatternFingerprint. The manifest binds the source index,
RDKit version, row count and record size; only a complete artifact is served.
Temporary `.partial` files are never advertised. The full two-corpus screen is
about 686 MiB. Reserve at least 3 GiB free and build one source at a time at low
priority. Existing dependencies are Python RDKit and NumPy on the scientific host;
no new toolchain or dataset copies belong on the application host.

```sh
nice -n 10 python3 services/owned-search/build.py --index-dir /data/macro-index --out-dir /data/owned-graph --source real
nice -n 10 python3 services/owned-search/build.py --index-dir /data/macro-index --out-dir /data/owned-graph --source virtual
python3 services/owned-search/test.py
bun server/test/owned-search.test.mjs
```

The staging candidate uses two separate loopback processes: `serve.py` for graph
and IDs and `services/macrocycle-index/serve.mjs` for bounded batch similarity.
Both reuse the existing scientific artifacts read-only. Never restart a shared
consumer scientific process on staging-only approval. Configure the staging
application's `OWNED_SEARCH_BASE` and `MACROCYCLE_SEARCH_BASE` through the private
SSH transport; the public browser never calls scientific loopback services.
The Python unit copies a fixed helper into the existing scientific API container
and invokes it with fixed argv plus JSON stdin. It uses that runtime's existing
private database settings; credentials never leave the container. The helper
sets transaction read-only, statement timeout and chirality for each request.
It does not change schema, data, grants, container configuration or its process.

Unit templates live in `deploy/staging/owned-search/`. Measure service identities,
capacity and transport before installation per `docs/OPERATIONS.md`. Rollback
stops only the new candidate units, restores the staging application's saved
endpoint configuration and release, and leaves existing scientific units/data
unchanged. For production, the server package must include the owned-search
module while graph/index artifacts stay on the scientific host.
