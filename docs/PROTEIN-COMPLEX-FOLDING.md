# Protein complexes with a candidate molecular glue

The Protein Folding screen uses the hosted **NVIDIA NIM OpenFold3** service.
Its **Protein complex + glue** mode creates space for two protein chains and one
candidate ligand, keeping any existing typed inputs. Additional protein chains
can be added through the same form. Each protein has its own sequence; the
ligand is supplied as exact SMILES (including stereochemistry) or a CCD code.
All entities are submitted in one `inputs[0].molecules` list for one complex
prediction. No ligand is designed or inferred from the sequences.

A candidate ligand is a hypothesis: a predicted complex does not establish that
it stabilizes a protein interaction, acts as a molecular glue, binds with a given
affinity or has biological activity. Inspect protein interfaces and ligand
placement, consider confidence, and validate experimentally. A comparison with a
separate ligand-free prediction may be useful, but is a separate prediction and
is not an automatically established difference in binding energy.

## Input and output contract

`client/src/utils/openfold.js` owns form validation and request/response mapping.
The guided glue mode refuses fewer than two proteins or a missing ligand before
sending the browser request. Blank inputs, duplicate IDs, nonstandard sequence
letters, overlong sequences, empty custom alignments and malformed CCD codes
also fail locally. Protein/DNA/RNA sequences are limited to 4096 residues per
molecule by the documented provider contract; no combined-capacity or runtime
promise is made. The current screen supports up to 26 entities with unique
single-character chain IDs. The helper accepts 1–4 alphanumeric IDs with mmCIF;
PDB needs one character. Upstream service limits and availability still apply.

Each protein gets either its supplied custom CSV MSA or a query-only A3M MSA
containing its sequence. Query-only input runs no homology search and can limit
complex-interface accuracy. RNA also gets a required query-only A3M alignment.
Paired alignments and template-guided predictions are provider features not
exposed by this form.

NVIDIA accepts `output_format: "pdb"` or `"cif"`. The form, viewer and saved
history call the latter `mmcif`; the request helper translates `mmcif` to `cif`
and normalizes CIF responses back to `mmcif`. PDB remains the default for docking.
The demo fixture accepts `cif` and legacy `mmcif`, producing explicitly labelled
placeholder coordinates rather than provider predictions.

Auth, active-user checks, server-owned credit charging/refunds, cancellation
semantics and history ownership use the existing folding path. Browser Cancel
stops waiting; it does not stop an already submitted provider job. Changing form
inputs does not change an already returned result or its download format.

## AlphaFold3 distinction

This feature is an OpenFold3 prediction workflow, not an AlphaFold3 deployment.
The [official OpenFold3 request examples](https://docs.nvidia.com/nim/bionemo/openfold3/1.3.0/example-requests.html)
document multi-chain protein inputs and ligand SMILES/CCD entities.
The [official AlphaFold3 parameter terms](https://github.com/google-deepmind/alphafold3/blob/main/WEIGHTS_TERMS_OF_USE.md)
currently limit public model parameters and output to specified noncommercial
uses, prohibiting use in connection with commercial activities, including
research on behalf of commercial organizations. A literal customer-facing
AlphaFold3 service therefore requires a separately authorized licensing and
provider path; do not silently substitute the product name or public weights.

## Verification

`bun scripts/check-openfold-contract.mjs` exercises request construction with
multiple proteins and an exact stereochemical ligand, guided-mode refusal,
provider sequence/ID bounds, MSA payloads, CIF normalization, fixture parity,
result scores and stable download identities. The client build checks UI wiring.
Neither check is proof that the hosted service produced a scientifically useful
protein–glue complex; real provider validation requires an authorized prediction
and returned coordinates, with any consumed credits accounted for.
