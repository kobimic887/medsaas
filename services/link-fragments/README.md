# Owned 3D linker service

Scientific service for the dashboard [Link Fragments](../../docs/LINK-FRAGMENTS.md)
workflow. Bun runs the service, its SQLite reader and the matching workers with the
application's RDKit WASM dependency. Optional refinement uses Python RDKit
(`LINK_FRAGMENTS_PYTHON`, default `/usr/bin/python3`; tested with Ubuntu
`python3-rdkit` 2023.09.3). The index builder requires only Python's standard library.

## Import

Keep data outside the repository, on the scientific data host:

```bash
python3 services/link-fragments/build.py \
  --input /path/to/Macrocyclic_linkers_confs_780273.zip \
  --out /path/to/linkers.sqlite --expected-rows 780273
```

Import streams one SDF from the archive, preserves original records as compressed
blobs, and indexes nominal 1.5 Å attachment distances in conformer (rowid) order.
It writes a new atomic index and JSON manifest; existing output paths are refused.
Source row IDs are conformation identities, separate from supplier/catalog
identifiers. Imported pairs include syntactically valid He combinations; the
fitting engine rejects chemically ineligible pairs such as two labels sharing one
neighbour. Import counts do not assert that every record yields a valid product.

## Serve

```bash
LINKER_INDEX_PATH=/path/to/linkers.sqlite PORT=8374 LINK_FRAGMENTS_WORKERS=2 \
  bun services/link-fragments/serve.mjs
```

Bind is `127.0.0.1`. `GET /status` returns manifest counts, method, limitations,
job queue state and refinement availability. Every other route requires the
`X-Pyxis-Owner` header (64 lowercase hex, derived by the application from the
signed-in user and company); other owners' jobs return 404.

| Route | Purpose |
| --- | --- |
| `POST /inspect` | Attachment eligibility and reasons for every atom |
| `POST /jobs` | Start a complete scan: `sdf`, two `attachments` (atom number or `{atom, hydrogenAtom}`), `maxRmsd` 0.1–1, `limit` 1–50 |
| `GET /jobs`, `GET /jobs/:id` | Owner's jobs; one job with progress and ranked result summaries |
| `POST /jobs/:id/cancel` | Cancel; partial results stay available |
| `GET /jobs/:id/results/:resultId` | Product SDF, atom mapping and any refinement |
| `POST /jobs/:id/results/:resultId/refine` | MMFF94/UFF refinement, optional receptor PDB (≤ 5 MB) |

Environment: `LINK_FRAGMENTS_WORKERS` (1–4, default 2),
`LINK_FRAGMENTS_MAX_JOB_SECONDS` (default 21600), `LINK_FRAGMENTS_REFINE_TIMEOUT_MS`
(default 90000) and `LINK_FRAGMENTS_PYTHON`. Keep the refinement budgets ordered:
Python child 90 s < application relay 140 s < browser 150 s. One job runs at a time;
the queue is bounded (429 `LINK_FRAGMENTS_QUEUE_FULL`) and each owner may have one
queued or running job (429 `LINK_FRAGMENTS_OWNER_BUSY` with that `jobId`).
Refinement failures keep their code: 422 for `REFINEMENT_UNSUPPORTED` and
`RECEPTOR_*`, 400 for invalid input, 504 for `REFINEMENT_TIMEOUT`, 503 for busy,
unavailable or failed; a closed request kills the Python child. Finished jobs stay in
memory for six hours. Refinement runs one at a time in a child process with a
minimal environment and a timeout. No raw source records or credentials are sent to
the application.

Deploy the entire service directory and the server RDKit dependency on the
scientific host. The application needs `services/link-fragments/sdf.mjs` for local
input parsing. Never copy the archive/index to the application host. Unit and tunnel
templates live in [deploy/staging](../../deploy/staging/README.md); operational paths
and release rollback evidence belong in private operator records.

## Tests

```bash
bun run test:link-fragments
```

Small fixtures reproduce the supplied query, matching linker and reference product.
Their provenance is Anna's September 29 email attachments; they are scientific test
examples, not a catalog or purchasable offer. `fixtures/receptor-7WH5-*.pdb` come from
RCSB PDB entry 7WH5 (CC0): the pocket keeps residues within 10 Å of ligand 9DF A301
with unchanged coordinates, all 9DF copies and waters removed; the query fragments'
heavy atoms coincide with 9DF A301. `refine-test.mjs` needs Python RDKit and skips
visibly without it — run it on the scientific host. The full library is not committed.
