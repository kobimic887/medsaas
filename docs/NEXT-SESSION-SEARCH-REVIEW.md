# Simulation stock search — measured live state

Updated **2026-09-07** after live import + public browser verification. This
replaces the earlier two-agent “reconcile / import pending” handoff.

## Live now

| | |
|---|---|
| Public app | `https://app.pyxis-discovery.com` (`84` `pyxis-web` `:5174`) |
| Deployed SHA | `c9a4cff` — scoped stock release (`release/stock-sim-scoped`); **not** full `main` |
| Rollback SHA | `ff166d0` (`/root/pyxis-LIVE-5174/ROLLBACK_SHA_BEFORE_STOCK`) |
| Stock dataset | live `:8000` **id 4**, `Stock compounds — 2026-09-01`, **630,646** rows |
| Method | RDKit Morgan (ECFP4) + Tanimoto for query and library; Anna’s MOE fingerprints archived only — **not MOE-equivalent** |
| Env | `STOCK_SEARCH_*` unset; defaults resolve via `TANIMOTO_API_BASE` + dataset name |

Import artifacts: `/home/ubuntu/scratch/stock-import/live-20260907/`. Contract and
ops detail: [`DATA-STOCK-COMPOUNDS.md`](./DATA-STOCK-COMPOUNDS.md).

## What was verified on the public signed-in Simulation page

Stock source → SMILES search → ranked hits with stock codes → scroll pagination
without duplicates → threshold clear → rapid Asinex↔Stock switching → select hit
→ SMILES in docking handoff (no paid job) → draw-mode UI + search → Asinex
regression. Empty/validation paths checked via the public API.

## Still out of scope / limitations

- Folding commit `2c9cc61` is on `main` but **not** in the live scoped deploy;
  it still lacks live prediction/browser proof.
- Default similarity slider may open at 0.7 (stock minimum allowed is 0.1);
  lower it to see near-neighbors beyond exact/self hits.
- Ketcher “draw then COPY SMILES” was exercised as a control; structure
  sketching itself is the existing editor, not a new stock feature.
- Do not re-import the live dataset without `--expect-existing` / explicit
  `--replace` approval.

## Next (only if asked)

- Optionally pin `STOCK_SEARCH_DATASET_ID=4` after any dataset renames.
- When folding is separately verified, decide whether to move `84` from the
  scoped stock SHA onto a fuller `main` release.
- Protein UX items remain deferred (`PROTEIN-DESIGN-RESEARCH.md`).
