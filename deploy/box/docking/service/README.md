# Pyxis private docking compatibility service

Internal replacement for the Asinex one-click docking endpoint. It prepares and caches receptors, selects a docking box, delegates pose generation through a pluggable engine, and serializes the result in the byte-sensitive shape consumed by the existing platform.

This service is unauthenticated compute. It must be reachable only from the platform server over the box's private network; never publish port 8000 to the public internet.

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

`pdbID` is the production spelling; lowercase `pdbid` is accepted as a compatibility alias. The SMILES value is percent-decoded exactly once before validation. A semicolon or comma is rejected as unsupported multi-molecule input rather than being allowed to crash native chemistry code.

`GET /health` returns `{"status":"ok"}` for a selectable backend. The deliberately unqualified `autodock-gpu` backend returns 503 so Compose cannot mark it ready by accident. Every unusable request or result returns a non-2xx response with `{"error":"readable message"}`; a 2xx response always means a complete, chargeable result.

## Docker-only verification

Do not install Python, RDKit, OpenMM, Meeko, Vina, or Node on the host. Run the test driver on a remote Docker-capable `linux/amd64` machine:

```bash
./deploy/box/docking/service/test.sh
```

The default run:

1. builds the Docker `test` and `runtime` targets;
2. runs replay tests with `--network none` and a read-only root filesystem;
3. boots the real HTTP image on an internal Docker network;
4. submits the measured 1CX7 request; and
5. runs the unchanged `scripts/verify-docking-response.mjs` in an official Node container.

The replay suite has no GPU and no network dependency. The committed raw RCSB PDB and measured Asinex response are packaged as fixtures.

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
| `replay` | Replays the committed production poses while exercising request normalization, receptor preparation/cache, and serialization | Default for offline tests; accepts only the committed 1CX7 request |
| `vina` | CPU AutoDock Vina reference backend | Testable with `RUN_VINA=1`; requires RCSB network access on a cold receptor |
| `autodock-gpu` | Future RTX PRO 4000 production backend | Deliberately returns 503 until hardware qualification; no unverified GPU binary is shipped |

AutoDock-GPU still requires an on-box decision. The old `nvcr.io/hpc/autodock:2020.06` image predates Blackwell `sm_120` and must not be assumed compatible. Qualification must start with the actual driver/GPU and a trivial dock; building upstream AutoDock-GPU for `TARGETS=120` is the expected path if the old image cannot run correctly.

## Compatibility reproduced bug-for-bug

The following behavior is intentional because the platform parses it with literal strings:

- response fields are only `pdb` and `sdf`;
- SMILES values in SDF properties are decoded, not the encoded request bytes;
- every pose title is `0:0:0` and the writer line is `     RDKit          3D`;
- property lines use two spaces after `>` and retain the trailing space after `(1)`;
- property order is `MODEL`, `TORSDO`, `SCORE`, `ligand_id`, `original_smiles`, `smiles`;
- scores are sorted numerically ascending, most negative first;
- the default torsion property reproduces Asinex's converter bug as `<TORSDO>` with value `F N`;
- all poses for one request receive the same decoded `<smiles>` value so the platform de-duplicates them into one row.

`EXPECTED_POSE_COUNT=5` is an engine target, not a success assertion. Any positive pose count is serialized. A mismatch is logged and counted; only zero poses is an outage.

Set `REPRODUCE_TORSDO_BUG=false` only with a coordinated frontend release that understands the clean `<TORSDOF>` property.

## Deliberate differences from Asinex

### Stable cached receptors

Asinex downloads and protonates the same receptor on every dock, so hydrogen positions vary between identical requests. This service caches the prepared receptor. Hydrogen positions therefore remain stable for a given receptor and preparation version. That is a deliberate improvement, not byte parity.

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

Keys are lowercase PDB IDs. Cold preparation happens in a sibling temporary directory under a per-PDB `flock`; only a complete, fsynced entry is published. Metadata includes the preparation hash, artifact SHA-256 digests, measured byte counts, and Vina map-subcache provenance. A preparation change invalidates the entry instead of silently serving stale chemistry.

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

Production behavior for a structure without a co-crystal ligand is unknown. The implemented fallback is a whole-protein blind box padded on every side. It emits an `APO_RECEPTOR_FALLBACK` warning and records the reason in `box.json`/`META.json`; it never guesses silently.

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

## Known unknowns

The measured production payload cannot establish all scientific settings. These remain explicit tuning/qualification items:

- production holo grid dimensions;
- production exhaustiveness, random seed, map spacing, and exact scoring-function build;
- production behavior for apo receptors (the loud blind-box fallback is new behavior);
- the exact third-party error body/status mapping (this service uses readable JSON and preserves the required non-2xx invariant);
- AutoDock-GPU behavior and performance on RTX PRO 4000 / Blackwell hardware.

Do not tune these by weakening the response verifier or the heavy-coordinate gate. The committed fixture and `scripts/verify-docking-response.mjs` are acceptance evidence, not implementation details to rewrite.
