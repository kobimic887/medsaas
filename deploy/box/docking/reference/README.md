# Docking reference fixture

`1cx7-asinex.json` is a captured upstream response containing only the `pdb` and `sdf`
result fields. Application account and history metadata are excluded. It is a compatibility
baseline for the [docking service](../service/README.md), not a current deployment record.

| Property | Baseline |
|---|---|
| Receptor | Public RCSB structure `1CX7` |
| Ligand SMILES | `Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C` |
| Poses | Five |
| Scores | `-4.547, -4.505, -4.468, -4.423, -4.345` |
| Receptor atoms | 1,290 heavy atoms and 1,307 hydrogens |
| Co-crystal ligand | `HED`, stripped during receptor preparation |

Scores are numerically ascending: most negative first. Positive pose counts other than
five are valid outputs; the fixture does not establish a fixed-count success requirement.

From the repository root:

```bash
node scripts/verify-docking-response.mjs --file candidate.json \
  --baseline deploy/box/docking/reference/1cx7-asinex.json
```

Run the same verifier with the baseline as `--file` to check fixture compatibility.
Do not change fixture bytes merely to make a new engine pass.

The captured success cannot establish upstream error responses, apo-receptor handling,
search-box dimensions or all engine settings. Those require separate implementation
choices and real-engine qualification. See [the response contract](../../../../docs/DOCKING-CONTRACT.md).
