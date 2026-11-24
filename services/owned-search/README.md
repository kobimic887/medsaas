# Owned source graph and identifier search

The authenticated application exposes `POST /api/owned-search` and
`GET /api/owned-search/status?source=stock|both|real|virtual|open`. These routes
never use the retired supplier catalog namespaces.

A request selects one source (`stock`, `smallvirtual`, `both`, `real`, `virtual`,
`open`) or `multi` with `sources` (1–4 distinct of stock/smallvirtual/real/virtual,
merged into one ranked list; similarity is Morgan binary Tanimoto only), and
`id`, `exact`, `substructure` or `similarity`,
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
- A substructure query that parses as plain SMILES is matched as a sanitized
  molecule (`substructure_query` in `serve.py`; stock uses `mol_from_smiles`), so
  Kekulé input, including every Ketcher drawing, matches aromatic rings, and its
  PatternFingerprint stays selective. Hydrogen counts are then not constraints.
  Radicals (`[CH2]`, `[#6]`), dummies (`*`), query bonds (`~`) and anything SMILES
  cannot parse keep their SMARTS meaning. Parsed as SMARTS, Kekulé `C1=CC=CC=C1`
  matched no aromatic row, and the SMARTS screen of a selective scaffold passed
  ~97% of VPX into per-row verification, which timed out.
- Open compounds uses official ChEMBL ID/structure/substructure APIs, then
  verifies exact canonical chemistry or substructure/chirality locally. ChEMBL
  substructure requires SMILES; arbitrary SMARTS is refused for that source.
  Query structures are sent to ChEMBL. Retrieved candidates are bounded, and
  their reported retrieval cap is preserved. Open similarity keeps the existing
  local Morgan re-score among retrieved ChEMBL candidates.

## Combined staging service

`services/owned-search/combined.mjs` is one loopback Bun service for staging.
`/health` and `/v1/*` (similarity) are served in process by
`services/macrocycle-index/serve.mjs`. `/graph/*` (ID/exact/substructure and stock
graph) is proxied to the `serve.py` child over a private Unix socket named by
`OWNED_SEARCH_SOCKET`; the child is never reachable over TCP. If the child dies,
the service exits and systemd restarts both, so it is never half up.

Two chemistry engines remain on purpose. The similarity index is fingerprinted by
RDKit WASM and the graph screens by Python RDKit, so moving either into the other
runtime would change results. The unit `deploy/staging/owned-search/pyxis-search-staging.service`
runs the combined service on 8276. `deploy/staging/owned-search/50-combined-search.conf`
points the staging app at it: `MACROCYCLE_SEARCH_BASE=<base>` and
`OWNED_SEARCH_BASE=<base>/graph`, through the existing 18276 tunnel. It replaces the two
staging units and the 18280 tunnel. Production uses the same service through the
same tunnel (its own `40-combined-search.conf` drop-in on `pyxis-web`); the older
shared 18274 macrocycle service is kept only as a rollback target. Test with `bun --cwd=server run test:owned-search`.

The unit runs from `search-releases/current`, a link to an immutable `git archive`
of `services/macrocycle-index`, `services/owned-search` and `server/utils` whose
`server/node_modules` links to the checkout's (RDKit WASM). Unlike the old units it
does not run from the mutable checkout, so a `git pull` never changes it.

## Stock identifier lookup

The shared stock table has no index on `ID`/`MAIN_BAS`/`compound_id`, so an
identifier search scans about 5 GB (~3.5 s per ID). Indexing it would change the
database production also uses, so `stock_ids.py` instead builds
`stock.ids.npy`/`stock.ids.json` in `OWNED_GRAPH_DIR` from a read-only export.
It is a candidate screen only: `stock_sql.py` re-applies the original text
equality to the candidates (~0.5 s per ID), and returns `stale` when the dataset
row count/min/max or the table's write counters changed since the build, after
which `serve.py` uses the full scan until a rebuilt lookup appears (picked up
without a restart). Postgres zeroes those counters after an unclean restart
(every host reboot); counters below their stored values with no write since
are that reset, not a change, so a reboot no longer forces the ~25 s full scan
that times out. ID queries written `ASN10396473` are normalized to the stored
`ASN 10396473`. `/graph/health` reports `stockIdLookup`
(`ready`/`stale`/`absent`/`invalid`). Rebuild after a stock import:

```sh
nice -n 10 python3 services/owned-search/stock_ids.py --out-dir <OWNED_GRAPH_DIR> --dataset-name '<stock dataset name>'
```

Write counters reach Postgres statistics about a second after a commit, so an
identifier renamed in place can be missed briefly; stock imports add datasets.

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

The previous staging candidate (replaced by the combined service above) used two
separate loopback processes: `serve.py` for graph and IDs and `services/macrocycle-index/serve.mjs` for bounded batch similarity.
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

## Local multi-SMARTS macrocycle annotation

Home → Results → **Macrocycle annotation · multi-SMARTS filter** checks the
structures in the loaded result rows. The preset is the owner-supplied
`Macrocycle_multiquery.txt`: all 58 unchanged SMARTS for labels 12–69. Text-file
imports accept one query per line, optionally followed by `!!label`; commas
inside SMARTS are retained. Up to 100 patterns and 2,000 loaded rows are checked
locally in a browser worker; proprietary structures never go to a remote
matching API. The worker loads the pinned RDKit JS/WASM runtime from a CDN.

Use **All rows with annotations**, **Matches to any pattern (OR)**, or **Matches
to every pattern (AND)**. Invalid/missing structures are *unknown*, distinct from
checked no-match rows. Invalid patterns, worker errors or a 30-second timeout
leave the table unfiltered; partial chemistry results are never applied.
New pages are rechecked. This is a loaded-results filter, not a complete
catalog scan or a definition of every possible macrocycle topology. In
particular, supplied `rN` atoms constrain the smallest perceived ring size:
fused systems can have a 12-atom outer perimeter and still fail every preset
pattern because their perceived rings are smaller.

Original result ordering, row identity, query text and selected structures are
preserved. Select-all acts on visible rows only; hidden selections remain in
docking/orders and are counted explicitly. Scroll pagination pauses while a
filter is active; use **Load more results** to inspect additional ranked rows.

Verification: `bun scripts/check-multi-smarts.mjs` uses the real RDKit runtime;
`RDKIT_MODULE=/path/to/RDKit_minimal.js` can select the exact worker build for
an isolated test without installing dependencies. Then run
`bun run test:simulation-search` for the integrated UI selection/docking handlers.

## Weekly stock availability snapshot (opt-in)

Stock offers can use the per-compound weekly snapshot written by
`scripts/stock-availability-snapshot.mjs` (`<dir>/<date>/{manifest.json,availability.csv}`)
instead of the imported `CURRENT_TOT_NETTO_MG`. Off by default: nothing changes until
both the host and the app are switched on, and the snapshot files stay on the
scientific host. The combined service serves them under `/stock-availability`
(`stockAvailability.mjs`), so the app reuses the existing 8276/18276 connection.

Rules once a snapshot is active:

- The snapshot amount is authoritative for `stock` rows, higher or lower than the import.
  A code missing from it, a zero, or under 1 mg has **no offer** (the row stays in search).
  Compounds with an `Exclusive` vial are sold; there is no maximum snapshot age.
- Every stock search offer path uses it: `/api/stock-search/similarity` and
  `/api/owned-search` (stock, multi, id/exact/substructure/similarity). RPX/VPX rows never
  consult it.
- New quotes (`/api/compound-shop/quote`, and a checkout that has no Stripe session yet)
  are revalidated against the current snapshot: gone or short stock → `409`
  `COMPOUND_STOCK_UNAVAILABLE` / `COMPOUND_STOCK_LIMIT`. This is a pure gate; quoted lines,
  fingerprints and the stored Stripe parameters are not changed. A checkout that already
  has a Stripe session is reconciled with Stripe first and never looks at stock.
- Fail closed: if the lookup service is unreachable, still loading, or holds only an
  invalid snapshot, stock rows get no offer and quotes answer `503`; the app never falls
  back to the imported amounts after the snapshot is switched on. "No snapshot activated"
  is the only state that keeps them.

Activation is explicit. `<dir>/ACTIVE.json` pins one date **and the CSV's SHA-256**, so a
same-date `--replace` is not live until activated again. `activate` validates everything
first (format, date, checksum, header, unique canonical codes, row count) and writes the
pointer atomically; a failing snapshot leaves the live one untouched. The running service
notices pointer changes within a second and keeps the last good snapshot if a reload
fails (`/stock-availability/status` then shows `degraded`).

```sh
# Host: one-time setup (needs a new search release and a restart of the SHARED combined
# service, so production approval): systemd drop-in on the combined unit
#   Environment=STOCK_AVAILABILITY_DIR=/home/ubuntu/.local/share/pyxis/stock-availability
# Weekly: build the snapshot (see docs/STOCK-AVAILABILITY.md), then, from the release dir:
bun services/owned-search/stockAvailability.mjs status
bun services/owned-search/stockAvailability.mjs activate 2026-11-02
# App: opt in through the existing tunnel, then restart the app service
#   STOCK_AVAILABILITY_BASE=http://127.0.0.1:18276/stock-availability
curl -s http://127.0.0.1:8276/stock-availability/status   # host-side check: state "active"
```

Rollback, fastest first: `bun services/owned-search/stockAvailability.mjs activate <older date>`
(previous snapshots are retained); `... deactivate` (removes the pointer: imported amounts
return, no restart); unset `STOCK_AVAILABILITY_BASE` and restart the app (the code path
is skipped entirely). Offers already issued stay valid for 24 hours; new quotes are checked
against whatever is active. Nothing is reserved between checkout and payment.

Tests: `bun --cwd=server run test:owned-search` (loader, activation, last-good retention,
fail-closed start, routing) and `bun --cwd=server run test:compound-shop` (offer paths,
quote/checkout revalidation, stored-Stripe-retry behaviour, real-server routes).
