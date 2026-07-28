# The docking output contract

**Captured 2026-07-28 from production, while Asinex was still answering.** This is Phase 0.1
of [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) — the one task whose deadline was set by the war
rather than by hardware delivery. It is now done, and this file is the reference the OSS
AutoDock rebuild has to match.

Source: the `simulation_logs` collection of the production database (MongoDB Atlas, database
name `test`). Everything below is observed, not inferred, except where marked.

---

## 1. What the platform stores

```js
{
  _id:           ObjectId,
  user:          { username: string, iat: number, exp: number },   // ← the raw JWT payload
  pdbid:         string,      // 4 chars, e.g. "1cx7"
  smiles:        string,      // URL-ENCODED — see §4
  result: {
    pdb:         string,      // ~210 KB — the prepared receptor
    sdf:         string,      // 5–10 KB — the docked poses
  },
  simulationKey: string,      // 12 chars, [a-z0-9], generated client-side of the engine
  timestamp:     Date,
  method:        "POST"
}
```

**The engine contract is `result`, and only `result`.** Everything else is the platform's own
bookkeeping. A replacement engine has to produce `{ pdb, sdf }` and nothing more.

> **Note — this is the *legacy* shape.** `user: {username, iat, exp}` is what the currently
> deployed `chem_beo` server writes. This repo's `server/index.js` writes `username`,
> `companyId` and `companyName` as separate top-level fields instead. Both shapes will exist in
> the collection after the migration. Anything reading `simulation_logs` must tolerate both.
> See [PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md).

## 2. `result.pdb` — the prepared receptor

Not the docked complex. The receptor alone, prepared and protonated:

```
REMARK   1 CREATED WITH OPENMM 8.2, 2026-05-12
ATOM      1  N   MET A   1      44.130  -3.214   9.264  1.00  0.00           N
ATOM      2  H   MET A   1      44.679  -3.758   8.342  1.00  0.00           H
...
ATOM   2597  OXT LYS A 162      49.193   1.597   0.690  1.00  0.00           O
TER    2598      LYS A 162
END
```

Observed properties:

- **Prepared with OpenMM 8.2** and stamped with a fixed date (`2026-05-12`) — the same string
  appears in records created in June and July, so it is the preparation date of a **cached**
  receptor, not the date of the dock. Asinex prepares each receptor once and reuses it.
- **Explicit hydrogens** (`H`, `H2`, `H3`, `HA`, `HB2`…). This is a protonated, minimised
  structure, not a raw RCSB download.
- Single chain `A`, terminated `TER` / `END`, with `OXT` on the C-terminal residue.
- Occupancy `1.00` and B-factor `0.00` throughout — B-factors were dropped in preparation.
- **Byte-identical across all records sharing a `pdbid`.** Confirms the cache.

**Implication for the rebuild:** the box needs a receptor preparation step producing the same
kind of artifact, and it should cache per PDB ID exactly as Asinex does. This lines up with the
`autogrid` map caching already planned in the runbook — same cache key, same lifetime.

## 3. `result.sdf` — the poses

A multi-record V2000 SDF written by RDKit, one record per pose:

```
0:0:0
     RDKit          3D

 18 19  0  0  0  0  0  0  0  0999 V2000
   33.2970   -0.6980   10.1950 C   0  0  0  0  0  2  0  0  0  0  0  0
...
>  <MODEL>  (1)
>  <TORSDO>  (1)
>  <SCORE>  (1)
>  <ligand_id>  (1)
>  <original_smiles>  (1)
>  <smiles>  (1)
$$$$
```

- **5 poses per dock** in every record observed (`$$$$` count = 5).
- Title line is the literal string `0:0:0`.
- Writer line is RDKit's (`     RDKit          3D`).
- Per-pose property tags, in this order: **`MODEL`, `TORSDO`, `SCORE`, `ligand_id`,
  `original_smiles`, `smiles`**.
- `SCORE` values from one dock: `-4.547, -4.505, -4.468, -4.423, -4.345` — descending, i.e.
  **sorted best-first**, in the kcal/mol range and sign convention of AutoDock binding affinity.

**`TORSDO` is the tell.** It is AutoDock's `TORSDOF` (torsional degrees of freedom) record,
carried through the PDBQT→SDF conversion. Together with the score range this is independent
confirmation of what the Asinex/Pyxis CEO stated: **the 1-click `/api/simulation` engine is
AutoDock.** Nothing here is DiffDock-shaped.

## 4. `smiles` is stored URL-encoded

Observed values:

```
Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C     →  Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C
c1ccc2c(c1)nc(o2)SCC(%3DO)O                         →  c1ccc2c(c1)nc(o2)SCC(=O)O
C%23Cc1ccc(cc1)C%23C                                →  C#Cc1ccc(cc1)C#C
```

`[`, `]`, `+`, `=`, `#` arrive percent-encoded and are **stored that way**. This comes from the
POST handler's `smiles === decodeURIComponent(smiles) ? encodeURIComponent(smiles) : smiles`
double-encoding guard. Any replacement must decode before handing SMILES to a toolkit, and the
cache lookup (`findOne({pdbid, smiles})`) matches on the **encoded** form — so re-encoding
differently silently misses the cache and charges the user again.

## 5. What the sample actually is

| | |
|---|---|
| Records | **4** |
| Distinct receptors | **2** — `1cx7`, `1cx6` |
| Date range | 2026-05-12 → 2026-07-08 |
| Method | `POST` on all four (no `GET` record exists) |
| Poses per dock | 5 |

**Four docks in three months.** The engine contract is well determined — the format is rigid
and consistent — but this is not a behavioural sample. Unknown from this data:

- What an **error** looks like. No failed dock was ever stored, which follows: the handler only
  writes on success. So the failure shape of the Asinex API is still uncaptured, and the fix in
  `956f9d9` (treat non-2xx as a failure rather than caching the body) was written blind.
- Whether pose count varies, or is fixed at 5.
- Behaviour for a receptor with multiple chains, or a ligand that fails preparation.
- Any `GET` path result, though the code writes the same `result` shape.

**If Asinex is still reachable, run a handful of deliberate docks** — a bad SMILES, an unknown
PDB ID, a multi-chain receptor — and record the responses here. That is the remaining gap, and
it closes when Moscow does.

## 6. Acceptance test for the replacement

The box's AutoDock service passes when, for `pdbid=1cx7` and a SMILES from §5, it returns:

- `result.pdb` — prepared receptor, explicit hydrogens, single chain, `TER`/`END`, cached and
  byte-stable across calls for the same `pdbid`
- `result.sdf` — V2000, RDKit writer line, N poses each carrying `MODEL`, `TORSDO`, `SCORE`,
  `ligand_id`, `original_smiles`, `smiles`, sorted by `SCORE` ascending (best first)
- Scores in a plausible AutoDock range for the pair — **compare against the stored values
  before trusting a new build**; the four records here are the only ground truth that exists

The client renders `result.pdb` in Molstar and `result.sdf` as poses. Getting the field names
right matters more than matching scores exactly — a different-but-valid docking result is
acceptable, a differently-shaped payload breaks the dashboard.
