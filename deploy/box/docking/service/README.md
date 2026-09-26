# Docking compatibility service

This service prepares and caches receptors, selects a docking box, runs a pluggable engine and returns PDB/SDF results compatible with the Pyxis application.

This service has no application authentication. Keep its published port on loopback and restrict access through [HTTPS ingress](../../ingress/README.md). Host identities and release records belong in [operations](../../../../docs/OPERATIONS.md).

## HTTP contract

```http
POST /docking
Content-Type: application/json

{"pdbID":"1cx7","smiles":"Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C"}
```

A successful response contains exactly two fields:

```json
{"pdb":"<prepared receptor PDB>","sdf":"<multi-record V2000 SDF>"}
```

The service also supports the legacy one-segment route:

```http
GET /docking/{pdbid}&{smiles}
```

`pdbID` is the request spelling; lowercase `pdbid` is accepted as an alias. URL-encoded SMILES is decoded once, while valid raw paired `%nn` ring labels are preserved. Semicolon and comma input separators are rejected.

`GET /health` returns `{"status":"ok"}` for a selectable backend. The deliberately unqualified `autodock-gpu` backend returns 503 so Compose cannot mark it ready by accident. Every unusable request or result returns a non-2xx response with `{"error":"readable message"}`; a 2xx response always means a complete, chargeable result.

## Docker-only verification

Use a Docker-capable `linux/amd64` host instead of installing the scientific toolchain on the development laptop. From the repository root:

```bash
./deploy/box/docking/service/test.sh
```

The default run:

1. builds the Docker `test` and `runtime` targets;
2. runs replay tests with `--network none` and a read-only root filesystem;
3. boots the real HTTP image on an internal Docker network;
4. submits the measured 1CX7 request; and
5. runs the unchanged `scripts/verify-docking-response.mjs` in an official Node container.

The replay suite has no GPU and no network dependency. The committed RCSB PDB and captured upstream response are packaged as fixtures.

The real CPU Vina/RCSB integration is explicit because it needs network access and can take several minutes:

```bash
RUN_VINA=1 ./deploy/box/docking/service/test.sh
```

Build only the deployable image with:

```bash
docker build --platform linux/amd64 \
  --target production \
  -t pyxis-docking \
  deploy/box/docking/service
```

Deployment uses the shared `deploy/box/compose.yml`; there is intentionally no docking-specific compose file.

## Engines

Select an implementation with `DOCKING_ENGINE`:

| Value | Purpose | Current status |
|---|---|---|
| `replay` | Fixture poses with normalization, receptor preparation/cache and serialization | Default for offline tests; accepts only the committed 1CX7 request |
| `vina` | CPU AutoDock Vina reference backend | Testable with `RUN_VINA=1`; requires RCSB network access on a cold receptor |
| `autodock-gpu` | Reserved GPU backend | Stub that deliberately returns 503 |

Set `DOCKING_ENGINE=vina` explicitly when using the implemented CPU backend. The shared Compose fallback is `autodock-gpu`, while the example environment selects `vina`. A GPU inventory or healthy replay service does not establish real inference readiness.

## Serialization compatibility

The following behavior is intentional because the platform parses it with literal strings:

- response fields are only `pdb` and `sdf`;
- SMILES values in SDF properties are decoded, not the encoded request bytes;
- every pose title is `0:0:0` and the writer line is `     RDKit          3D`;
- property lines use two spaces after `>` and retain the trailing space after `(1)`;
- property order is `MODEL`, `TORSDO`, `SCORE`, `ligand_id`, `original_smiles`, `smiles`;
- scores are sorted numerically ascending, most negative first;
- the default torsion property preserves the legacy converter output as `<TORSDO>` with value `F N`;
- all poses for one request receive the same decoded `<smiles>` value so the platform de-duplicates them into one row.

`EXPECTED_POSE_COUNT=5` is an engine target, not a success assertion. Any positive pose count is serialized. A mismatch is logged and counted; only zero poses is an outage.

Set `REPRODUCE_TORSDO_BUG=false` only with a coordinated frontend release that understands the clean `<TORSDOF>` property.

## Receptor preparation and cache

### Stable cached receptors

Prepared receptors are cached. Hydrogen positions remain stable for a given receptor and preparation version; this does not promise byte-for-byte parity with another engine's preparation.

Original RCSB heavy atoms are gated through preparation and must remain at exactly the source coordinates after PDB serialization. HETATMs are stripped, OXT is the only permitted added heavy atom, and hydrogens are added without minimizing the receptor.

### Cache layout and lifecycle

`CACHE_DIR` defaults to `/srv/cache`:

```text
/srv/cache/
  locks/{pdbid}.lock
  receptors/{pdbid}/
    source.pdb
    receptor.pdb
    receptor.pdbqt
    box.json
    maps/
    META.json
```

Keys are lowercase PDB IDs. Cold preparation happens in a sibling temporary directory under a per-PDB `flock`; only a complete, fsynced entry is published. A shared lease protects cached files while docking, so replacement or purge waits for active readers. Metadata includes the preparation hash, artifact SHA-256 digests, measured byte counts, and Vina map-subcache provenance. A preparation change invalidates the entry instead of silently serving stale chemistry.

The host cache directory must be writable by container UID/GID 10001:

```bash
sudo install -d -o 10001 -g 10001 -m 0750 /srv/cache
```

Cache administration uses the running image:

```bash
docker compose -f deploy/box/compose.yml exec docking pyxis-docking-cache warm 1cx7 8g43
docker compose -f deploy/box/compose.yml exec docking pyxis-docking-cache purge 1cx7
docker compose -f deploy/box/compose.yml exec docking pyxis-docking-cache purge-stale
```

`warm` performs receptor preparation only; it does not invoke a docking engine.

### Apo fallback

Upstream behavior for a structure without a co-crystal ligand is not established by the reference fixture. The implemented fallback is a whole-protein blind box padded on every side. It emits an `APO_RECEPTOR_FALLBACK` warning and records the reason in `box.json`/`META.json`; it never guesses silently.

For holo structures, the box is centered on the largest eligible non-water, non-ion HETATM residue. The visible exclusion set includes waters, monoatomic ions, buffers, cryoprotectants, precipitants, and common crystallization additives.

## Configuration

All operational and chemistry defaults are centralized in `docking_service/settings.py`.

| Environment variable | Default | Meaning |
|---|---:|---|
| `CACHE_DIR` | `/srv/cache` | Receptor, lock, and map-cache root |
| `DOCKING_ENGINE` | `replay` | `replay`, `vina`, or `autodock-gpu` |
| `EXPECTED_POSE_COUNT` | `5` | Requested pose count and warning target; never a hard success count |
| `VINA_BOX_X` | `22.0` Å | Holo grid width |
| `VINA_BOX_Y` | `22.0` Å | Holo grid height |
| `VINA_BOX_Z` | `22.0` Å | Holo grid depth |
| `VINA_EXHAUSTIVENESS` | `8` | Vina search exhaustiveness |
| `VINA_SEED` | `20260729` | Vina random seed |
| `VINA_SCORING_FUNCTION` | `vina` | Vina scoring function |
| `VINA_ENERGY_RANGE` | `1000000.0` kcal/mol | Pose-return energy window |
| `VINA_MIN_RMSD` | `1.0` Å | Minimum pose separation |
| `VINA_MAX_EVALS` | `0` | Vina evaluation limit (`0` lets Vina choose) |
| `VINA_CPU` | `1` | CPU threads per Vina worker |
| `VINA_TIMEOUT_SECONDS` | `540` | Native worker deadline, below the caller's 600 s timeout |
| `VINA_MAP_SPACING` | `0.375` Å | Grid-map spacing |
| `VINA_FORCE_EVEN_VOXELS` | `true` | Force even map voxel counts |
| `VINA_NO_REFINE` | `true` | Disable post-dock refinement |
| `REPRODUCE_TORSDO_BUG` | `true` | Emit legacy `TORSDO` / `F N`; false emits clean `TORSDOF` / `N` |
| `DEFAULT_TORSDOF` | `0` | Fallback torsion count if an engine omits it |
| `APO_BOX_PADDING` | `8.0` Å | Whole-protein fallback padding per side |
| `RECEPTOR_PH` | `7.0` | PDBFixer hydrogenation pH |
| `PDBFIXER_SEED` | `20260729` | Terminal-atom preparation seed |
| `RCSB_TIMEOUT_SECONDS` | `30.0` | Cold-cache RCSB request timeout |
| `RCSB_MAX_SOURCE_BYTES` | `25000000` | Maximum accepted PDB response size |

`PREP_VERSION` is a code-level cache-invalidation value rather than an environment variable. Bump it whenever receptor preparation semantics change.

## Qualification limits

The captured reference cannot establish all scientific settings. These require separate qualification:

- upstream holo grid dimensions;
- upstream exhaustiveness, random seed, map spacing and scoring-function build;
- apo-receptor behavior (the explicit blind-box fallback is an implementation choice);
- the exact third-party error body/status mapping (this service uses readable JSON and preserves the required non-2xx invariant);
- any future AutoDock-GPU implementation and its target-hardware performance.

Do not tune these by weakening the response verifier or the heavy-coordinate gate. The committed fixture and `scripts/verify-docking-response.mjs` are acceptance evidence, not implementation details to rewrite.
