# Owned 3D linker service

Scientific service for the dashboard [Link Fragments](../../docs/LINK-FRAGMENTS.md)
workflow. Bun runs the service and its SQLite reader; the index builder requires only
Python's standard library. Chemistry uses the application's existing RDKit WASM
dependency. No Python RDKit installation or raw multi-GB SDF expansion is needed.

## Import

Keep data outside the repository, on the scientific data host:

```bash
python3 services/link-fragments/build.py \
  --input /path/to/Macrocyclic_linkers_confs_780273.zip \
  --out /path/to/linkers.sqlite --expected-rows 780273
```

Import streams one SDF from the archive, preserves original records as compressed
blobs, and indexes nominal 1.5 Å attachment distances. It writes a new atomic index
and JSON manifest; existing output paths are refused. Source row IDs are conformation
identities, separate from supplier/catalog identifiers. Imported pairs include
syntactically valid He combinations; the fitting engine rejects chemically ineligible
pairs such as two labels sharing one neighbor. Import counts do not assert that every
record will yield a chemically valid product.

## Serve

```bash
LINKER_INDEX_PATH=/path/to/linkers.sqlite PORT=8374 \
  bun services/link-fragments/serve.mjs
```

Bind is `127.0.0.1`. `GET /status` returns manifest counts, method and limitations.
`POST /search` accepts `sdf`, two one-based `attachmentAtoms`, `maxRmsd` (0.1–1) and
`limit` (1–20). The distance index supplies at most 250 candidate pairs; fitting runs
in a cancellable worker with one active search and a time limit. Results expose
scanned/available counts and truncation. An occupied service refuses with 503.
No raw source records or database credentials are sent to the application.

Deploy the entire service directory and the server RDKit dependency on the scientific
host. The application also needs `services/link-fragments/sdf.mjs` for local input
inspection. Never copy the archive/index to the application host. Unit and tunnel
templates live in [deploy/staging](../../deploy/staging/README.md); operational paths
and release rollback evidence belong in private operator records.

## Tests

```bash
bun run test:link-fragments
```

Small fixtures reproduce the supplied query, matching linker and reference product.
Their provenance is Anna's September 29 email attachments; they are scientific test
examples, not a catalog or purchasable offer. The full library is not committed.
