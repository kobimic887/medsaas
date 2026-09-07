# Stock compounds dataset — Anna's MOE export (2026-09-01)

Support for searching Anna's stock-compound corpus in Pyxis Discovery. The
**intended UI is the Simulation tab** (source toggle Asinex | Stock compounds);
the Deep Similarity dataset picker remains useful for scoped Tanimoto work but
is not this workflow. The importer is
[`scripts/import-stock-compounds.mjs`](../scripts/import-stock-compounds.mjs) —
read its header for the full flag reference. This file records the inspection,
the import contract, and what the frontend needs.

## Provenance

| | |
|---|---|
| Source URL | `https://spectra.pyxis-discovery.com/CompChem/STRUCTURES_20260901_63652_unique.zip` |
| Zip sha256 | `2a5f1b531766d706e72ab7a3c0f1a0ae1bf11b81c58f42884468918b254885c4` |
| Extract | single TSV `STRUCTURES_20260901_63652_unique.txt` (~3.16 GB, CRLF) |
| Txt sha256 | `e2d21d10e4ec3f6276447cd145de4177091fc4f60e86a712f08611747885a562` |

The file name says "63652_unique", but the file holds **630,652** data rows (one
digit was dropped in the name). Keep the source TSV and its sha256 with the
project data as the preservation artifact — large files are **not** committed to
Git (`.gitignore`/out-dir policy below).

## Inspection summary (pass over all 630,652 rows)

- **Format:** 16-column TSV, one header row, 630,652 data rows. Columns:

  | # | column | meaning |
  |---|---|---|
  | 1 | `mol` | MOE SMILES of the structure |
  | 2 | `MAIN_BAS` | stock code, `"<prefix> <number>"`, e.g. `ASN 04188606` |
  | 3 | `ID` | numeric string == number part of `MAIN_BAS` (all rows) |
  | 4–5 | `CURRENT_TOT_AMOUNT_UM`, `CURRENT_TOT_NETTO_MG` | stock amounts |
  | 6–16 | `FP:MACCS`, `FP:GpiDAPH3`, `FP:piDAPH3`, `FP:ECFP4_2048`, `FP:ECFP4`, `FP:FCFP4`, `FP:FCFP4_2048`, `FP:ECFP6`, `FP:ECFP6_2048`, `FP:FCFP6`, `FP:FCFP6_2048` | MOE fingerprints |

- **Structures:** all rows non-empty; SMILES length 5–146 (`[OCCCN]` shortest);
  no whitespace/newlines inside a structure; no rows where the `mol` field is
  missing or unparseable at the TSV level. 88 rows share an **identical `mol`
  string with an earlier row** (same structure under a different stock code —
  distinct stock entries; kept, counted, listed in `duplicate_mols.txt`).
- **Identifiers:** `MAIN_BAS` is always an alphabetic prefix + number (all 50
  prefixes alpha; largest: BAS 191,444 · ASN 128,223 · LAS 80,214 · BDE 54,173).
  `ID` is 8 digits for 626,164 rows (9 digits: 4,487; 7 digits: 1) and has
  leading zeros in 261,785 rows — identifiers must stay **strings**. No
  duplicate `ID`s and no `ID` ≠ `MAIN_BAS` number.
- **Amounts:** no empty/non-numeric/negative; UM 0.2–1,789,407.4 µmol; MG
  0.15–804,573 mg.
- **MOE fingerprint columns** are space-separated sparse **key lists**, not
  packed bit vectors — this matches MOE docs where `FP:MACCS` (sparse list of
  present keys) is distinct from `FP:BIT_MACCS`. Confirmed on all 630,652 rows:
  - `FP:MACCS`: keys 3–165, 4–105 keys/cell, none empty. (MOE MACCS key numbers,
    already a feature list — not RDKit MACCS bit positions.)
  - `FP:ECFP4_2048`/`FCFP4_2048`/`ECFP6_2048`/`FCFP6_2048`: keys 0–2047 with
    repeated keys inside a cell (fold-collisions listed as duplicates) — the
    MOE-native text dump of folded vectors.
  - `FP:ECFP4/6`, `FP:FCFP4/6`: keys 0–32767, up to 259 keys/cell.
  - `FP:GpiDAPH3`/`FP:piDAPH3`: 72 empty cells each (structures with no
    matching environment), keys up to 262143.
- **No MOE version/settings metadata** in the file (plain TSV).

## Engine decision (why not MOE fingerprints)

Pyxis similarity search is backed by the tonomitosql service (repo
`kobimic887/tonomitosql`; medsaas `server/index.js` proxies `/tanimoto/*`).
tonomitosql ingests CSV with a `smiles` column and computes **all six search
fingerprints** (morgan, maccs, feat_morgan, atom_pair, torsion, rdkit) inside
PostgreSQL with the RDKit cartridge — the **same implementation and settings
for library and query molecules**. So this import feeds the `mol` SMILES column,
and the DB recomputes the search fingerprints from those structures.

MOE `FP:*` columns are **preserved only in the source TSV** (plus sha256
manifest); they are never compared against RDKit query fingerprints — a MOE
`FP:MACCS` sparse key list is not an RDKit MACCS bit vector, and nothing here
claims results reproduce MOE. Requirement 5 is satisfied by deriving both sides
from the same SMILES through the same cartridge.

## Import command (reproducible, no secrets)

```bash
bun scripts/import-stock-compounds.mjs \
  --input <extracted TSV or the .zip> \
  --base-url <tonomitosql base URL> \
  --name "Stock compounds — 2026-09-01" \
  --out-dir <data dir outside the repo> \
  --verify
```

- **Input:** the extracted `STRUCTURES_20260901_63652_unique.txt` (or the zip —
  streamed via `unzip -p`). Header must match the 16 `EXPECTED_COLUMNS`; the
  script refuses to guess on mismatch.
- **Base URL / config:** no auth on tonomitosql — keep it internal. Live search
  service defaults to `http://151.145.91.17:8000` in `server/index.js`
  (`TANIMOTO_API_BASE`). Verification used the **isolated scratch stack**
  `http://127.0.0.1:8010` on oracleOld (compose: `/home/ubuntu/scratch/
  tonomitosql-stock`, loopback-only, own volume) — never import to the live
  stack or production data without explicit approval.
- **Outputs** (in `--out-dir`, outside the repo): generated upload CSV,
  `import-report.json` / `import-report.md`, sha256 manifest. Tracked in Git:
  only this importer and this doc.
- **Idempotency:** dataset exists with the same `--name` → abort with a pointer
  to `--replace` (delete + re-import) or `--expect-existing` (verify
  `row_count` == source accepted and no-op). Re-running never silently
  duplicates.
- **Rejected records:** source-level rejects (empty `mol`/`ID`, duplicate `ID`)
  are itemized in the report. On arm64 the engine's API container has no
  rdkit-pypi, so cartridge-invalid SMILES are dropped without row-level errors;
  the script bisect-uploads chunks to a throwaway diagnostic dataset to identify
  each offender (observed: exactly **6** of the 630,652 rows rejected by the
  RDKit cartridge, `mol_from_smiles` NULL).
- **Runtime (measured 2026-09-05, oracleOld scratch):** client-side parse + CSV
  ≈ 50 min; upload → engine commit **≈ 12.5 h** (630,646 molecules × 6 cartridge
  fingerprints on one Ampere core). The upload timeout is 24 h. A client timeout
  does **not** lose the import — the server-side transaction still commits
  (observed twice); recover with `--dataset-id <id> --verify` against the
  committed dataset instead of re-uploading.

## API / data contract for the frontend

Deep Similarity Search (`client/src/pages/dashboard/deep-similarity.jsx`)
lists available datasets in an authenticated picker. It defaults to **All datasets**
(no `dataset_id`); selecting a dataset scopes exact, similarity, and substructure
searches and clears previous results. Failed dataset loading offers retry while
all-dataset search remains available. Dataset scoping works at the API level:

- `GET /tanimoto/v1/datasets` → `{ datasets: [{ id, name, filename, row_count,
  created_at }], count }` (proxied through `server/index.js` with auth).
- `GET /tanimoto/v1/search/similarity?smiles=…&threshold=…&fingerprint_type=…&similarity_metric=…&dataset_id=<id>` —
  the proxy forwards `req.query`, so `dataset_id` passes straight through.
  Same for `/search/exact` and `/search/substructure`.
- Each result item: `molecule_id`, `canonical_smiles`, `similarity` (ranked
  desc), `metadata`. For stock rows `metadata` contains `ID`, `MAIN_BAS`,
  `compound_id` (== `MAIN_BAS`, duplicated because the result card renders
  `compound_id` as the identifier), `CURRENT_TOT_AMOUNT_UM`,
  `CURRENT_TOT_NETTO_MG` — so stock hits show a recognizable compound code
  without a frontend change.
- The dataset record for this import: name **`Stock compounds — 2026-09-01`**
  (naming convention = default dataset name; the engine falls back to the CSV
  filename only when `dataset_name` is missing).

The picker only lists datasets in the configured search service. Live Simulation
stock search resolves the dataset by name (default) on the shared
`TANIMOTO_API_BASE` service — see **Live state** below.

## Verification evidence

**Live dataset (2026-09-07, oracleOld `:8000`):** dataset **id 4**, name
`Stock compounds — 2026-09-01`, **630,646** rows = 630,652 accepted source rows −
6 cartridge-invalid SMILES. Import report:
`/home/ubuntu/scratch/stock-import/live-20260907/import-report.json` (parse
accepted 630,652 / rejected 0; engine valid 630,646; silent drops 6;
verification **51/51**). Importer `--verify` confirmed self-search at similarity
1.0 with original `ID` under all six fingerprint types, exact match, and ranked
morgan@0.3 with the probe at the top. Ranked offset pages through the Pyxis
proxy share no `molecule_id`s. Public signed-in Simulation browser checks on
`https://app.pyxis-discovery.com` (2026-09-07) passed: stock availability
banner, SMILES + draw-mode search, ranked hits, infinite-scroll next pages
without duplicates, threshold clear, source switching, selection → docking
SMILES handoff (no paid job), empty/validation API paths, and Asinex regression.

**Earlier scratch evidence (2026-09-06, isolated `:8010`, dataset id 10):** same
row count and 51/51 verify path used before live import. The scratch stack was
removed 2026-09-07 after isolated UI verification to free disk for the live
import (~4 GB). Do not recreate it unless a new isolated experiment needs it.

**Earlier runs (2026-09-05, scratch):** smoke (2,000 rows), name-check
(100 rows), and rejected-record fixture runs — re-import abort, `--replace`,
`--expect-existing`, and rejected-record reporting — all passed.

## Picker verification

`bun run test:similarity-datasets` executes the component with lightweight React
hook/element adapters and controlled HTTP responses to check authenticated listing,
all three scoped search modes, the full-corpus default, and listing failure/retry.
Set `STOCK_SEARCH_BASE` to an isolated search service to also verify its stock
dataset listing. This does not substitute for a signed-in browser test through
the application proxy.

## Simulation search — the real destination (2026-09-06)

The dataset picker on the Deep Similarity screen was the **wrong user workflow**.
The intended destination is the Simulation tab's molecule search
(`client/src/pages/dashboard/simulation.jsx`), which used to search only the
ASINEX catalog. It now has a **Search in: `Asinex catalog` | `Stock compounds
(similarity)`** source toggle. Both corpora live in the same result list and feed
the same selection → docking/DiffDock handoff. Switching sources clears results
and aborts in-flight requests; a failed/unprovisioned stock search is shown as
such and **never silently falls back to the ASINEX corpus**.

### Server configuration contract (env, not hardcoded)

`server/utils/stockSearch.js` owns the config; `server/index.js` mounts two
authenticated routes (`ensureMongoConnected → authenticateToken →
requireActiveUser`, same as the ASINEX proxies):

| Route | Purpose |
|---|---|
| `GET /api/stock-search/status` | Availability: resolves the dataset and returns `{ available, dataset:{id,name,rowCount}, fingerprintType:'morgan', similarityMetric:'tanimoto' }` or `{ available:false, reason }` |
| `GET /api/stock-search/similarity?smiles=&threshold=&offset=&limit=` | Ranked similarity over the stock dataset; relays the engine payload |

Client calls go through `API_CONFIG.buildApiUrl()` with `Authorization`, so the
internal unauthenticated tonomitosql service is never exposed to the browser.

The dataset/backend are **explicitly configured** — nothing is hardcoded (in
particular not scratch `:8010` or dataset id 10):

- `STOCK_SEARCH_BASE` — tonomitosql base URL holding the stock dataset. Unset →
  the shared `TANIMOTO_API_BASE` service (the normal production shape after a
  live import). Point it at an isolated stack only for dev/verification.
- `STOCK_SEARCH_DATASET_ID` — pin the dataset by numeric id (optional).
- `STOCK_SEARCH_DATASET_NAME` — dataset name for discovery when the id is unset.
  Default `Stock compounds — 2026-09-01` (matches the importer default).

When no dataset resolves, `status` reports `available:false` and `similarity`
answers **503 `STOCK_SEARCH_UNAVAILABLE`** — a configuration state, not a dead
session (never a same-origin `401`). Upstream search-service auth/5xx failures
relay as **502**; validation (`smiles`/`threshold`/`offset`/`limit`) is **400**.

### Fingerprints: RDKit, computed the same way for query and library

Anna's MOE export ships `FP:MACCS` (sparse key lists) and 11 more MOE
fingerprint columns, and the MOE PDF (local copy under
`~/.t3/userdata/attachments/…-pdf.pdf`) confirms they are MOE-native
representations. **The Simulation stock search does not use any of Anna's MOE
fingerprints.** The tonomitosql engine computes RDKit fingerprints (Morgan
radius 2 ≈ ECFP4, Tanimoto metric by default) from SMILES for **both** the query
and every library structure — the same implementation and settings on both
sides, so results are internally consistent. MOE FP:* columns stay preserved
only in the source TSV; comparing RDKit query fingerprints to MOE library
fingerprints would not be scientifically valid, and nothing in this repo claims
MOE-equivalent results. The UI labels the method honestly ("ranked by RDKit
Morgan (ECFP4) Tanimoto similarity").

### Stock result rows and pagination

Each engine hit is `{ molecule_id, canonical_smiles, similarity, metadata }`;
metadata carries `ID`, `MAIN_BAS`, `compound_id`, `CURRENT_TOT_AMOUNT_UM`,
`CURRENT_TOT_NETTO_MG` as strings (leading zeros intact). The Simulation mapper
(`client/src/utils/stockResults.js`) exposes the **stock code as the row
identity**, keeps `molecule_id` as the separate engine row id, and deliberately
invents **no** Asinex fields: no IUPAC/InChI/formula/MW, no prices, no
availability — the table shows a Stock ID, SMILES, similarity, and the µmol/mg
values labelled as **dated snapshot quantities** (not purchasable in this flow).
Ranked pagination is by **offset/limit** over the engine's stable KNN ordering
(measured 2026-09-06 against scratch: same-query offset pages share no rows and
keep the ranking; the engine exposes no total count, so the page end is "fewer
than limit rows returned"). A fresh search resets the offset, so new queries can
never append stale pages.

### ASINEX pagination defect (measured) — fixed only where provable

While integrating stock search we measured the configured ASINEX provider
(`/api4/*`): rows carry a numeric `id` and the BAS/substructure/molecular-weight
responses are ordered by it, with `fromId` meaning "start after this id". The
Simulation page used to compute its cursor as `parseInt(ASINEX_ID)` — but
`ASINEX_ID` is the display code (`"ASN 04188606"`), so the cursor was always 0
and "load more" repeated page one. The cursor now uses the numeric row `id` for
the id-ordered modes. Score-ranked `/api4/similarity` has **no provable
id-continuation** on the provider (it returns at most self/exact hits), so its
first page is treated as the complete result instead of looping. (The ranked
similarity path in this screen is the stock source above.)

### Verification

- `server/test/stock-search.test.mjs` — config, dataset discovery/cache,
  validation, URL building, status relay (unit).
- `server/test/stock-search-route.test.mjs` — spawns the real server + memory
  Mongo against a fixture-backed stub: auth (401 without token), dataset
  discovery by name, ranked page 1 + offset page 2 with **no shared
  `molecule_id`**, empty page, 400 validation, honest result fields.
- Fixtures under `server/test/fixtures/stock-similarity-*.json` are **real
  engine responses** captured 2026-09-06 from the isolated scratch stack
  (query `O=C(O)c1ccccc1`, morgan+tanimoto, threshold 0.35).
- `scripts/check-simulation-search-lifecycle.mjs` asserts the source-switch /
  offset-pagination / unavailable-state / honest-stock-rows invariants in
  `simulation.jsx` and exercises the mapper on the real fixtures.
- Run: `bun run test:stock-search` (unit + route) and `bun run
  test:simulation-search` (UI invariants). `bun run test` includes both.

Automated harnesses remain the regression gate (`bun run test:stock-search`,
`bun run test:simulation-search`). Public browser proof is recorded under
**Verification evidence** / **Live state** above. Do not launch a paid docking
job just to verify selection; the handoff uses the same `searchCode` SMILES
flow as ASINEX hits.

## Live state (measured 2026-09-07)

| | |
|---|---|
| App host | `84` / `pyxis-web` `:5174` → `https://app.pyxis-discovery.com` |
| Deployed SHA | `c9a4cff` (`release/stock-sim-scoped`: stock Simulation commits cherry-picked onto `ff166d0`; **excludes** unverified folding `2c9cc61` from `main`) |
| Prior SHA (rollback) | `ff166d0` — also stamped `/root/pyxis-LIVE-5174/ROLLBACK_SHA_BEFORE_STOCK` |
| Search service | live tonomitosql `http://151.145.91.17:8000` (`TANIMOTO_API_BASE`; `STOCK_SEARCH_*` unset → defaults) |
| Dataset | **id 4**, name `Stock compounds — 2026-09-01`, **630,646** rows |
| Existing corpus | dataset id 3 `DATA` (2,951,975) preserved |
| Import artifacts | `/home/ubuntu/scratch/stock-import/live-20260907/` (`STATUS.txt`, `import-report.*`, `LIVE_VERIFY.txt`) |

**Scientific method (do not blur):** Simulation stock search ranks Anna’s stock
**structures** with RDKit Morgan (ECFP4) + Tanimoto computed the same way for
query and library inside tonomitosql. Anna’s MOE `FP:*` columns remain archived
in the source TSV only — they are **not** compared to the query. Results are
**not** MOE-equivalent.

### Re-import / recovery (only if needed)

The live dataset already exists — do **not** re-run the importer blindly. Same
`--name` aborts unless `--expect-existing` (verify counts) or `--replace`
(explicit approval). A disconnected client does not cancel the server
transaction; recover with `--dataset-id <id> --verify`. Measured live import
wall time 2026-09-07 was ~1.25 h (parse + upload/commit + verify), shorter than
the earlier ~12.5 h scratch measurement on a cold stack.

### Rollback (app)

- Point `STOCK_SEARCH_DATASET_NAME` at a non-existent name (or unset discovery)
  → status `available:false`, similarity **503 `STOCK_SEARCH_UNAVAILABLE`**.
  Asinex unchanged.
- Or redeploy prior `:5174` SHA `ff166d0` (stock toggle/routes absent).
- Do **not** delete live dataset id 4 as the first rollback step.

### Integration corrections (2026-09-07)

Changing the stock threshold cancels pending pages and clears the old ranking and
offset; submit Search to run the new threshold. Stock threshold slider minimum is
0.1 (default slider value may still be 0.7 until changed). Returning to Stock
retries an interrupted availability check. The server passes its resolved
TANIMOTO_API_BASE into stock configuration when neither search-base environment
variable is set.
