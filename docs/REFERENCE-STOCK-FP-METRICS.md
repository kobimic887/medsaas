# Reference: Anna's MOE btanimoto/ctanimoto numbers vs Pyxis stock search

**What this file is:** the attributed record of Anna's reported MOE results
(2026-09-12), the live verification against the tonomitosql stock dataset on the
same date, and the analysis of why the two are **not expected to agree**. It is a
reference record, not a spec — the searchable contract lives in
[`docs/DATA-STOCK-COMPOUNDS.md`](DATA-STOCK-COMPOUNDS.md) ("Fingerprint and
metric selectors"). A structured copy of the reference data is
[`server/test/fixtures/anna-moe-btanimoto-reference.json`](../server/test/fixtures/anna-moe-btanimoto-reference.json).

**Bottom line:** morgan/tanimoto on the live dataset reproduces Anna's Pyxis
report exactly (26 hits @ 0.3). Her MOE numbers (~30 btanimoto, ~2000 ctanimoto)
came from a fingerprint we cannot identify with settings nobody recorded, on
count-capable MOE feature lists. The delta is explained, documented, and **not
an error to fix**.

## Provenance

| | |
|---|---|
| Reported by | Anna (CompChem) |
| Reported | 2026-09-12, via email quoted by the product owner |
| Query | `O=C1NC2C(NCCC2)CC1` (the engine echoes the canonical form `O=C1CCC2NCCCC2N1` — same molecule) |
| MOE fingerprint used by Anna | **Unknown** — no MOE version or fingerprint-settings metadata exists anywhere; her source TSV (`medsaas-data/stock-20260901/`) carries 11 `FP:*` columns and none is identified as the searched one |
| Searched library | Anna's stock export (630,652 source rows; 630,646 imported after 6 cartridge-invalid SMILES) |

## Her three reported results (all at threshold 0.3)

| System | Method as reported | Hits |
|---|---|---|
| Pyxis (our UI) | RDKit Morgan (ECFP4) + Tanimoto | **26** |
| MOE | btanimoto | **~30** (30 IDs listed, below) |
| MOE | ctanimoto | **~2000** (no ID list) |

Her metric definitions, verbatim:

- **btanimoto** = deduplicate the feature lists, then set Jaccard.
- **ctanimoto** = `Σ(x_i*y_i) / (Σx_i² + Σy_i² − Σx_i*y_i)` using feature
  frequencies.

## Her 30 MOE btanimoto IDs (her given order)

```text
BBF 26741742   BDF 25209134   BBF 26741743   ART 22406379   LEG 22406373
BAS 02785771   BDE 33851247   BAS 15430487   ART 13378607   LAS 33849678
BDF 26741673   LAS 33959485   BDG 24428593   LOL 35614412   LEG 22406385
BDE 22406382   LAS 33818212   LAS 34068237   ASN 15425097   BBF 25514934
ASN 33720967   ASN 30011914   BBF 25209133   ASN 33727025   ASN 33717623
ASN 31037608   ASN 29760245   ASN 33727021   LAS 33959489   BBF 25209170
```

## Live verification (2026-09-12)

tonomitosql **dataset 4** (`Stock compounds — 2026-09-01`, **630,646 rows**),
Anna's query, threshold 0.3 unless noted. `count` is page-limited by the engine,
so "≥1000" means the limit-1000 page returned a full page.

| Fingerprint | tanimoto | dice |
|---|---|---|
| morgan | **26** — reproduces her Pyxis report exactly | ≥1000 |
| maccs | DiskFull @0.3 (64MB shm parallel gather); OK with noparallel | DiskFull @0.3 (same); OK with noparallel |
| feat_morgan | 858 | ≥1000 |
| atom_pair | 231 | ≥1000 |
| torsion | 102 | ≥1000 |
| rdkit | ≥1000 | DiskFull @0.3 (64MB shm parallel gather); OK with noparallel |

Those failures were **Postgres parallel gather DiskFull inside the db
container’s 64MB `/dev/shm`** (“No space left on device”) — **not** host disk
capacity and not missing fingerprint support. Fix: keep global
`ORDER BY similarity DESC, id ASC` and `SET max_parallel_workers_per_gather = 0`
(do not silently KNN-cap at 1000). (Re-verify manually with
`scripts/verify-stock-fp-metrics.mjs`.)

### Overlap: our 26 (morgan/tanimoto) vs her 30 (btanimoto)

- **13 shared IDs:** ART 22406379, LEG 22406373, BAS 02785771, BAS 15430487,
  LEG 22406385, BDE 22406382, ASN 15425097, ASN 33720967, ASN 30011914,
  ASN 33727025, ASN 33717623, ASN 29760245, ASN 33727021.
- **17 of hers are absent from our 26:** BBF 26741742, BDF 25209134,
  BBF 26741743, BDE 33851247, ART 13378607, LAS 33849678, BDF 26741673,
  LAS 33959485, BDG 24428593, LOL 35614412, LAS 33818212, LAS 34068237,
  BBF 25514934, BBF 25209133, ASN 31037608, LAS 33959489, BBF 25209170.
- **13 of ours are not in her 30:** ASN 33717614, ASN 33717624, ASN 13858508,
  ASN 29760234, RFN 29801174, BAS 23531158, BAS 08767683, ASN 33727023,
  BBC 26580122, ASN 33721197, BBD 27288885, BAS 00025753, LAS 30979215.

**Interpretation (plainly):** the two runs used **different fingerprints** — ours
is RDKit Morgan radius 2 bit vectors, hers is an unidentified MOE fingerprint
with unknown settings — and the one-sided overlap (13 of her 30 = 43%, 13 of our
26 = 50%) is what that predicts. This is **not** an error to fix; it is two
defensible answers to two different questions. Her btanimoto/ctanimoto numbers
are reference data, not reproducible targets.

## Binary vs count, hand-worked

Binary Tanimoto and Dice on identical bit vectors `A = [1,0,1,0]`,
`B = [1,1,0,0]`: intersection `c = 1`, `|A| = |B| = 2`.

- Tanimoto = `c / (|A| + |B| − c)` = `1/3` ≈ 0.333
- Dice = `2c / (|A| + |B|)` = `2/4` = **1/2**

Count vectors `x = [2,0,1]`, `y = [1,1,0]` (Anna's ctanimoto formula):
`Σx_i*y_i = 2`; `Σx_i² = 5`; `Σy_i² = 2`.

- ctanimoto = `2 / (5 + 2 − 2)` = `2/5` = **0.4**
- Its binary reduction (`x>0`, `y>0` → `[1,0,1]`, `[1,1,0]`) = `1/3` ≈ 0.333

Same inputs, different scores — binary ≠ count even before fingerprint choice
enters. Both engine metrics are binary formulas (see below), so neither can
reproduce ctanimoto, and no UI label may call a score count-based.

## Engine evidence

- `~/projects/tonomitosql/app/services/search.py` `FP_CONFIG` maps all six
  fingerprints to **bit-vector** cartridge types: morgan→`mfp2`
  (`morganbv_fp(...,2)`), maccs→`maccs` (`maccs_fp`), feat_morgan→`ffp2`
  (`featmorganbv_fp`), atom_pair→`apfp` (`atompairbv_fp`), torsion→`ttfp`
  (`torsionbv_fp`), rdkit→`rdfp` (`rdkit_fp`). `SIM_CONFIG` maps
  tanimoto→`tanimoto_sml` (`%` / `<%>`) and dice→`dice_sml` (`#` / `<#>`) —
  binary formulas over those bit vectors. There is **no count-vector option and
  no count-Tanimoto cartridge operator** in the engine.
- Anna's archived MOE `FP:*` columns are **never imported**; the engine
  recomputes RDKit fingerprints from SMILES for library and query alike. In the
  source TSV the MOE `FP:ECFP4/FCFP4` (+`ECFP6/FCFP6`) columns carry
  **multiplicity** (repeated keys — count fingerprints — 10.4M+ adjacent
  duplicates in ECFP4) in MOE's 15-bit hash space (0–32767; `_2048` columns are
  a mod-2048 fold of the same lists), while `FP:MACCS` is binary. An
  RDKit-query × MOE-library comparison is therefore **impossible and forbidden**
  — different implementations, different hash spaces, different (partly
  unknown) settings.
- Engine `ORDER BY <sml_func>(…) DESC, m.id ASC` ranks **before**
  `OFFSET`/`LIMIT` (`tonomitosql` ≥ `1e71b0c`). Equal similarity is ordered by
  `m.id` ascending. Do not restore KNN-operator ordering with a secondary key —
  that breaks OFFSET pages. Per-page stable sort + client dedupe in Pyxis remain
  defense in depth.

## Questions Anna must answer before any MOE-parity work

1. **Which fingerprint did the MOE search use?** The export carries 11 `FP:*`
   columns; the search-panel fingerprint is recorded nowhere.
2. **Which MOE version and fingerprint settings** (hash space, fold size —
   e.g. `FP:ECFP4` vs `FP:ECFP4_2048`)? No version metadata exists in the
   export.
3. **Can she export the btanimoto hit list with per-hit scores?** Score
   distributions are comparable; bare ID counts are not.
4. **Threshold semantics:** is her 0.3 on the same inclusive 0..1 scale, and is
   it applied before or after feature-list deduplication?
5. **Library identity:** was the searched library exactly this 630,652-row
   export, or an earlier/local copy with different filtering?
6. **ctanimoto denominator:** confirm the MOE ctanimoto she ran is exactly
   `Σxy/(Σx²+Σy²−Σxy)` as she wrote — required before a count metric could ever
   be exposed (see the blocked-dependency sketch in DATA-STOCK-COMPOUNDS.md).

Until those are answered, Pyxis ships honest labels
("RDKit Morgan (ECFP4)", "(binary)") and treats her numbers as context, not a
target.
