# Docking contract

This reference describes the one-click docking path and the format a replacement
service must preserve. DiffDock uses a separate API. Implementations and checks:

- Application routes: [`server/index.js`](../server/index.js).
- Result UI: [`molstar3d.jsx`](../client/src/pages/dashboard/molstar3d.jsx).
- Payload verifier: [`verify-docking-response.mjs`](../scripts/verify-docking-response.mjs).
- Compute service: [`deploy/box/docking/`](../deploy/box/docking/).

## Request and response

The dashboard submits `POST /api/simulation` with `{ pdbid, smiles }`.
Authentication, active-user checks, tenant-scoped caching, and credit accounting
belong to the application. A cached result is returned before charging.

The application sends the configured engine:

```json
{
  "pdbID": "1cx7",
  "smiles": "<URL-encoded SMILES>"
}
```

The capital `D` in `pdbID` matters. Decode SMILES before passing them to a
chemistry toolkit. Keep application cache keys consistent with the existing
encoding; changing normalization can bypass cached results.

The engine responds with `{ pdb, sdf }`, both strings. The application owns the
simulation key and persistence. Its upstream timeout is ten minutes. Upstream
failure returns 502 and refunds the charge; an application 401 is reserved for
an invalid session.

A legacy GET engine call also exists, using one path segment:
`/<encoded-pdbid>&<encoded-smiles>`. This is not a query string. A replacement
must account for both application routes.

## Receptor and pose files

`pdb` contains the prepared receptor, not a docked complex. Preparation should
preserve the requested receptor and distinguish heavy-atom agreement from
hydrogen placement. The reference preparation removes ligand/water/ion HETATM
records, adds terminal oxygen and hydrogens, and preserves heavy-atom
coordinates. Hydrogen coordinates need not be byte-identical across runs.

`sdf` is a multi-record V2000 SDF, with one record per pose, separated by
`$$$$`. Keep numeric `SCORE` values ordered ascending: the lowest score is
best under this contract. Relevant properties are:

| Property | Meaning |
|---|---|
| `MODEL` | Pose identifier |
| `SCORE` | Numeric docking score |
| `ligand_id` | Ligand identifier |
| `original_smiles`, `smiles` | Decoded structure strings |
| `TORSDO` / `TORSDOF` | Torsion metadata; the viewer accepts either spelling |

All poses of one ligand must share the same `smiles`. The minimal-SDF route
groups on that value and retains the lowest-scoring pose.

**Preserve the literal prefixes `>  <smiles>` and `>  <SCORE>`: two spaces
after `>`, with the stated case.** The server's minimal-SDF parser matches
them exactly, even though the browser parser is more tolerant. Values belong on
the next line, followed by a blank line. Missing or differently formatted tags
can produce HTTP 200 with no usable ligand rows.

## Viewer handoff

The dashboard requests `/api/simulation?includeResult=false` and receives a
`simulationKey`. Callers omitting that option retain the full result response.

The viewer normally loads the public RCSB receptor, falling back to the prepared
PDB URL when needed. The prepared receptor remains available through
`/api/sanitizedpdb/:key`. Clickable ligand rows come from
`/api/sanitizedminimalsdf/:key`; individual pose retrieval uses the simulation
key separately. Artifact endpoints enforce application authentication and
tenant ownership.

A successful submission alone does not establish a working viewer. Verify the
stored artifact routes, reduced ligand rows, numeric scores, and selected pose
rendering.

## Replacement qualification

Use a qualified receptor/ligand pair and compare the prepared receptor, score
convention, poses, and artifacts with a reference. Grid placement and dimensions,
receptor preparation, search settings, and random seed affect chemistry even
when the response format is correct. A co-crystal-based grid must exclude water
and ions when selecting its ligand; apo receptors need an explicit policy.
Do not infer those choices from a successful JSON response.

```bash
node scripts/verify-docking-response.mjs --file candidate.json --baseline reference.json
```

For an approved test service, the verifier can submit a request:

```bash
node scripts/verify-docking-response.mjs \
  --url http://127.0.0.1:8000/docking \
  --pdbid 1cx7 --smiles 'CCO' --save candidate.json
```

The verifier checks payload and parser compatibility. It does not prove docking
accuracy or service readiness. Follow it with a real authenticated browser
handoff and scientific review of suitable reference pairs. Deployment and
private reference locations belong in [operator records](OPERATIONS.md).
