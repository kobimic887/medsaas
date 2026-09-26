# Docking acceptance requirements

The service replaces the one-click docking API while preserving the application's
PDB/SDF contract. Implementation, configuration and test commands are in
[`service/README.md`](service/README.md); parser details are in
[the docking contract](../../../docs/DOCKING-CONTRACT.md).

## HTTP and normalization

- Accept `POST /docking` with `pdbID` and `smiles`; accept lowercase `pdbid` as an alias.
- Preserve the legacy `GET /docking/{pdbid}&{smiles}` compatibility route.
- Normalize PDB IDs, decode URL-encoded SMILES once, and preserve valid raw paired `%nn`
  ring labels. Reject malformed encoding and unsupported semicolon/comma input separators.
- Return only `pdb` and `sdf` on success. A successful result needs at least one usable pose;
  five poses is a request target, not a hard success count.
- Return non-2xx readable JSON for unusable input, unavailable engines or unusable results.
  An incomplete result must not look chargeable to the application.

## Receptor and result integrity

Preserve source heavy-atom coordinates exactly through PDB serialization. Strip HETATMs;
OXT is the permitted additional heavy atom. Add hydrogens without minimizing the receptor.
Use exact chain/residue/insertion-code/atom identity and preserve TER boundaries.

For holo structures, choose the largest eligible co-crystal ligand after excluding waters,
ions and common additives. For apo structures, use the explicit whole-protein fallback and
record a warning; this fallback is not measured upstream parity.

Preserve the parser-sensitive SDF title, writer line, tag spacing, property order and
legacy `TORSDO` behavior. Sort scores numerically ascending and apply the same decoded
SMILES to every pose. See the [reference](reference/README.md) for the baseline.

## Cache and engines

Publish prepared-receptor cache entries atomically under per-receptor locks. Validate
metadata and artifact digests; hold a read lease while an engine uses cache files so purge
or replacement cannot remove them mid-job. Preparation changes invalidate the cache.

`replay` serves the fixed compatibility fixture. `vina` is the implemented CPU engine.
`autodock-gpu` returns 503 until an implementation and target-hardware qualification exist.
Do not label fixture output as real docking or weaken the response verifier to accept it.

## Acceptance

Use the Docker test driver and, separately, `RUN_VINA=1` for real CPU/RCSB integration.
Run `scripts/verify-docking-response.mjs` on the candidate response without modifying the
baseline or verifier to fit the implementation. Confirm the viewer receives the receptor
and corresponding poses, and verify application credit/refund behavior during cutover.

Target-host GPU support, scientific tuning and throughput need their own measured evidence.
See [compute cutover](../../../docs/ARRIVAL-RUNBOOK.md) for deployment gates.
