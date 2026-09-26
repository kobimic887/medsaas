# Fingerprints and similarity metrics

A similarity score is meaningful only with its fingerprint implementation,
settings, and metric. Two tools labelled “ECFP4” need not use identical
invariants, hashes, standardization, or folding. Matching a metric name alone
does not establish matching results.

## Supported methods

| Collection | Fingerprints | Metrics |
|---|---|---|
| Stock | RDKit Morgan, MACCS, Feature Morgan, atom pair, torsion, RDKit path | Binary Tanimoto and Dice |
| Macrocycles | RDKit Morgan | Binary Tanimoto; format-2 indexes also support Count Tanimoto and Count Dice |
| Open compounds | RDKit Morgan | Binary Tanimoto |

The library and query must use the same fingerprint representation. Pyxis
does not compare RDKit query fingerprints with imported MOE feature lists and
does not claim MOE parity. Imported fingerprint columns are retained in source
data for provenance, not used as interchangeable RDKit vectors.

## Binary and count formulas

For binary sets A and B, with intersection size c:

- Tanimoto: `c / (|A| + |B| - c)`.
- Dice: `2c / (|A| + |B|)`.

For frequency vectors x and y:

- Count Tanimoto: `Σxy / (Σx² + Σy² - Σxy)`.
- Count Dice: `2Σxy / (Σx² + Σy²)`.

Counts preserve repeated environments that binary vectors discard. Therefore,
the same threshold has different meaning across these methods. Labels must
say “binary” or “frequency-weighted” as appropriate.

## Count-method safeguards

[`countMorgan.js`](../server/utils/countMorgan.js) computes the frequencies of
retained RDKit Morgan environments in the index's 2048-bit space. Its nonzero
positions must equal the binary Morgan fingerprint. This is checked against
RDKit in `server/test/count-morgan.test.mjs` and for every indexed structure.

Count metrics are advertised only for a compatible macrocycle index. They are
not stock-search options. Isotope-labelled queries are refused for count
methods until that invariant is qualified; binary search remains available.

Reproducing another tool requires its exact fingerprint settings and version,
structure preparation, metric definition, searched dataset, and reproducible
query/results. A reported hit count alone is not an acceptance test.

See [stock search](DATA-STOCK-COMPOUNDS.md) and
[macrocycle indexing](DATA-MACROCYCLES.md) for API and artifact contracts.
