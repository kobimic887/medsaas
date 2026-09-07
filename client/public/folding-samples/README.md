# Folding sample structures

Example coordinate files used by the Protein Folding page's "Sample structures
for viewer testing" (PDB and mmCIF cases). These are **pre-existing example
structures, not newly generated NVIDIA predictions**, and carry no confidence
scores.

| File | Content | Provenance |
|---|---|---|
| `1crn.pdb` | Crambin, PDB format | RCSB PDB entry **1CRN** — `https://files.rcsb.org/download/1CRN.pdb` (crambin, 46-residue plant protein; public scientific data). Fetched 2026-09-07, stored unmodified. |
| `1crn.cif` | Crambin, mmCIF format | RCSB PDB entry **1CRN** — `https://files.rcsb.org/download/1CRN.cif`. Fetched 2026-09-07, stored unmodified. |

The UI labels anything loaded from here as an example structure for viewer
testing and records this provenance; the files are never presented as a fresh
prediction. Input presets (guided form examples) reference the same public
1CRN sequence and are documented in `client/src/data/foldingSamples.js`.
