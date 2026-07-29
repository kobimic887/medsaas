# Docking service handoff

## Goal

Finish and verify `deploy/box/docking/BRIEF.md` implementation under:

```text
deploy/box/docking/service/
```

Replacement serves Asinex-compatible `POST /docking` and legacy GET form. Amsterdam box remains compute-only.

## Read first

1. `deploy/box/docking/BRIEF.md` — current source of truth.
2. `docs/DOCKING-CONTRACT.md` — measured production contract.
3. `deploy/box/docking/reference/README.md`
4. `scripts/verify-docking-response.mjs` — immutable acceptance oracle; do not edit.
5. `deploy/box/docking/service/README.md`

Important current brief changes:

- Any positive usable pose count succeeds. Request target remains 5, but count mismatch only logs/warns. Fail only on zero poses.
- No docking-specific compose file. Shared `deploy/box/compose.yml` already wires service. Conform to it; do not edit it.
- Tests and service execution must happen inside Docker on remote Linux/amd64, not owner Mac.

## Repository state

At handoff time:

```text
?? deploy/box/convertstr/       # unrelated concurrent work; do not touch
?? deploy/box/docking/service/  # this implementation
?? install.sh                   # pre-existing user file; do not touch
```

No commit was created.

`deploy/box/docking/docker-compose.yml` is correctly absent.

## Fixture integrity

These hashes were checked:

```text
d4536ba7dfbdc96e82f4a4660ac2a299b2ed0996a2f3331905d0d36f7dfa73dd  deploy/box/docking/reference/1cx7-asinex.json
d4536ba7dfbdc96e82f4a4660ac2a299b2ed0996a2f3331905d0d36f7dfa73dd  deploy/box/docking/service/docking_service/assets/1cx7-asinex.json
686df46f0d270dc90246ee05d8c84094fc7cebbcf22772e2de7ce9970b29d286  deploy/box/docking/service/docking_service/assets/1cx7.pdb
```

Do not change canonical reference fixture or verifier.

## Implemented

### HTTP and contract

- `POST /docking` accepts `pdbID`; lowercase `pdbid` alias supported.
- Legacy `GET /docking/{pdbid}&{smiles}` parses raw path.
- Success returns only non-empty `{pdb, sdf}`.
- Errors use readable `{ "error": "..." }` and non-2xx.
- Semicolon and comma inputs are counted and warning-logged separately, then rejected.
- RCSB `.pdb` 404 message explains entry may be mmCIF-only.
- Positive non-5 pose counts succeed and warn; zero fails.
- SDF serializer reproduces exact parser-sensitive tag spacing/order/case and legacy `TORSDO` value.

### Engines

- `replay` uses committed fixtures and normal receptor/cache/serializer path.
- `vina` uses subprocess-isolated worker, Meeko/RDKit ligand handling, map cache, and positive-pose policy.
- `autodock-gpu` remains explicitly unavailable until hardware qualification.

### Receptor and cache

- RCSB/fixed-fixture clients.
- HETATM ligand selection before stripping; visible exclusion list; HED selection; apo whole-protein fallback.
- Public PDBFixer/OpenMM OXT and hydrogen path with source-heavy coordinate gates.
- Meeko receptor PDBQT generation.
- Atomic receptor cache, flock locks, metadata/digests/measured sizes, warm/purge CLI.
- Shared cache lease now protects receptor artifact paths while docking. Purge/replacement waits for active readers.

### Docker and tests

- Multi-stage `Dockerfile`: runtime, test, production targets.
- Runtime and test requirements now correctly split:
  - `requirements.txt` = runtime/scientific dependencies.
  - `requirements-test.txt` = pytest only.
- `test.sh` runs Docker-only replay suite, live replay service, immutable Node verifier, optional Vina suite.
- Node verifier container now mounts only verifier and baseline, runs unprivileged, drops capabilities, and uses `no-new-privileges`.

## Recent critical fixes already present — verify them

These were edited immediately before handoff but never executed:

### 1. Raw SMILES `%nn` ring labels

`docking_service/normalization.py` now preserves raw paired SMILES ring labels such as:

```text
C%10CCCCC%10
```

while decoding:

```text
C%2510CCCCC%2510
```

once to same raw SMILES.

Existing tests cover `%10`. Add `%12` too if useful.

### 2. Exact PDBFixer topology identity

`docking_service/receptor.py` no longer matches residue IDs by prefix. Old code made residue `1` collide with `102`, `106`, etc., breaking 1CX7 replay before response.

Current code uses exact:

```text
(chain id, residue id, insertion code, residue name, atom name)
```

through `_topology_identity()`.

This needs Docker proof with OpenMM 8.2/PDBFixer 1.12.

### 3. TER preservation

`_atom_only_pdb()` now strips HETATM while retaining TER boundaries. This prevents same-chain-ID protein segments being merged before PDBFixer.

### 4. Cache lease

`ReceptorCache.lease()` now holds shared flock through docking. `DockingService.dock()` uses it. Exclusive purge/replacement should wait until receptor PDBQT is no longer in use.

`tests/test_cache_lifecycle.py` contains thread-based lease-vs-purge coverage.

### 5. Map metadata validation

`vina_worker._valid_maps()` now rejects malformed metadata, unsafe names, traversal paths, symlinks, wrong sizes, and wrong hashes by returning stale/invalid instead of raising `AttributeError`.

### 6. Verifier mount hardening

`test.sh` now mounts only:

```text
scripts/verify-docking-response.mjs
deploy/box/docking/reference/1cx7-asinex.json
```

instead of whole repository.

## Finish these before declaring done

### P0 — required

- [ ] Add/finish receptor regression tests for exact topology identity:
  - residue `1` versus `10`/`102`;
  - insertion code identity;
  - no prefix matching;
  - original heavy coordinates unchanged.
- [ ] Add/finish TER regression test for `_atom_only_pdb()` and preparation-level chain boundaries.
- [ ] Add direct cache-key validation tests for uppercase, `../`, slashes, and malformed IDs.
- [ ] Add malformed map metadata tests: scalar `details`, traversal filename, symlink, wrong hash/size; expect rebuild path, not crash.
- [ ] Confirm `tests/test_receptor_invariants.py` currently imports `_assert_topology_coordinate_gate` and `_atom_only_pdb`; make sure imports are used by real tests.
- [ ] Build and run Docker test target on native Linux/amd64.
- [ ] Run offline replay suite with network disabled.
- [ ] Run live replay endpoint through immutable Node verifier. Exit 0 required.
- [ ] Verify replay request reaches receptor preparation and does not return 422 from identity gate.
- [ ] Verify heavy atoms against raw 1CX7: 1,289 source heavy atoms at 0.0000 Å plus only OXT; hydrogens present; no HETATM; TER/END present.

### P1 — Vina proof

- [ ] Run `RUN_VINA=1 ./test.sh` on network-enabled Linux/amd64 Docker host.
- [ ] Confirm pinned packages install and import:
  - OpenMM 8.2.0
  - PDBFixer 1.12.0
  - RDKit 2026.3.4
  - Meeko 0.7.1
  - Vina 1.2.7
- [ ] Confirm actual Meeko 0.7.1 APIs used by receptor and ligand code match installed release.
- [ ] Confirm Vina maps build before ligand, persist, load in fresh worker, and survive second dock.
- [ ] Extend real Vina integration to dock twice against same receptor and prove map/preparation reuse. FakeVina unit test alone is not enough.
- [ ] Confirm fewer than 5 positive poses still return 200 and usable SDF.
- [ ] Confirm zero poses returns non-2xx.

### P2 — small coverage gaps

- [ ] Add receptor-layer test for real `HttpRcsbClient` 404 translation to readable mmCIF-aware error.
- [ ] Add `caplog` assertion for semicolon/comma warning fields and hash-only logging; raw SMILES must not be logged.
- [ ] Check README defaults against `settings.py` and shared `deploy/box/compose.yml`.
- [ ] Check cache orphan temp/retired cleanup after interrupted publication.
- [ ] Consider multiprocess lease/purge proof. Existing test uses threads; `flock` production behavior is cross-process.

## Remote verification commands

Run from repo root on Docker-capable native Linux/amd64 host:

```bash
cd deploy/box/docking/service
./test.sh
```

Optional real CPU Vina/RCSB integration:

```bash
RUN_VINA=1 ./test.sh
```

Manual build/import check if runner fails early:

```bash
docker build --platform linux/amd64 --target test -t pyxis-docking:test deploy/box/docking/service

docker run --rm --platform linux/amd64 pyxis-docking:test \
  python -c "import fastapi, openmm, pdbfixer, rdkit, meeko, vina; print('imports ok')"
```

Brief acceptance shape:

```bash
docker build -t pyxis-docking deploy/box/docking/service

docker run --rm --name pyxis-docking-replay \
  -e DOCKING_ENGINE=replay \
  -e CACHE_DIR=/tmp/cache \
  -p 127.0.0.1:8000:8000 \
  pyxis-docking
```

Then:

```bash
curl -sS -X POST http://127.0.0.1:8000/docking \
  -H 'Content-Type: application/json' \
  -d '{"pdbID":"1cx7","smiles":"Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C"}' \
  > candidate.json

node scripts/verify-docking-response.mjs \
  --file candidate.json \
  --baseline deploy/box/docking/reference/1cx7-asinex.json
```

Expected verifier exit code: `0`.

## Known environment blocker

Current Mac has no Docker, Buildx, Compose, or native linux/amd64 runtime. No successful service, Python, chemistry, or Docker test was run here. Static inspection and fixture hash checks only.

Do not claim complete until remote Docker replay succeeds. Do not claim Vina qualified until real network-enabled Vina run succeeds.

## Scope guardrails

Do not modify:

```text
deploy/box/compose.yml
deploy/box/.env.example
deploy/box/convertstr/
scripts/verify-docking-response.mjs
deploy/box/docking/reference/
server/
client/
.github/workflows/
install.sh
```

No standalone docking compose file. No nginx/TLS/DNS/firewall/API/Atlas changes. No AutoDock-GPU qualification before box arrives.
