# Reference payload — the only ground truth that exists

`1cx7-asinex.json` is **a real response from Asinex's production docking service**, pulled from
the `simulation_logs` collection of the production database on 2026-07-29.

```json
{ "pdb": "<210,435 bytes>", "sdf": "<9,380 bytes>" }
```

It is exactly what `POST {dockingApiUrl}` returned, before the platform added `simulationKey`.

**Why it is in the repo.** Asinex is in Moscow and goes down because of the war. When it is
gone, this file and three others like it are the only evidence of what the replacement has to
produce. Four docks exist in three months of production; this is one of them.

**Nothing here is sensitive.** The receptor is [RCSB `1CX7`](https://files.rcsb.org/download/1CX7.pdb),
public. The ligand is a catalogue compound. There is no user, credential, or account data — the
platform's own fields (`username`, `companyId`, `simulationKey`, `timestamp`) were stripped and
only `result` was kept.

## What it is a dock of

| | |
|---|---|
| `pdbid` | `1cx7` |
| SMILES | `Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C` |
| poses | 5 |
| `SCORE` | `-4.547, -4.505, -4.468, -4.423, -4.345` — descending, best first |
| receptor | 2,597 atoms — 1,290 heavy + 1,307 hydrogens, chain A, `TER`/`END` |
| prepared | `REMARK   1 CREATED WITH OPENMM 8.2, 2026-05-12` |
| search box | centred on `HED`, the co-crystal ligand, stripped during preparation |

## Use it

```bash
# does a candidate engine's output reach the screen the same way?
node scripts/verify-docking-response.mjs --file candidate.json \
                                         --baseline deploy/box/docking/reference/1cx7-asinex.json

# the reference itself passes, which is what makes it a baseline
node scripts/verify-docking-response.mjs --file deploy/box/docking/reference/1cx7-asinex.json
```

## Two things it cannot tell you

- **What a failure looks like.** The platform only writes on success, so no failed dock was
  ever stored and Asinex's error shape is unknown.
- **What happens for an apo structure.** Every stored dock uses a receptor with a co-crystal
  ligand, which is where the search box comes from. A receptor without one has no box centre by
  that rule.

**Both are answerable only while Moscow still answers.** If Asinex is reachable, run a bad
SMILES, an unknown PDB ID, and an apo `pdbid`, and add the responses here.

Full analysis: [`docs/DOCKING-CONTRACT.md`](../../../../docs/DOCKING-CONTRACT.md).
