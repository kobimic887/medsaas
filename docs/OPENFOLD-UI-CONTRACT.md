# OpenFold3 folding contract

Folding uses the hosted NVIDIA OpenFold3 service. The authenticated
`/api/openfold3/predict` proxy forwards requests and responses;
[`openfold.js`](../client/src/utils/openfold.js) owns client normalization.

## Inputs and results

- Ligands use `ccd_codes`.
- Without a custom CSV MSA, proteins use a query-only A3M alignment. The UI
  explains that a richer alignment may improve prediction.
- Unique chain IDs and empty custom alignments are checked before submission.
- Structures are read from `outputs[].structures_with_scores[]`.
- Each result retains its submitted name and coordinate format independently
  of later form edits.
- Confidence values are displayed only when finite. They are not binding
  affinities.
- A response without structures is an error, not a JSON file labelled as PDB.

## Viewer boundary

[`ProteinFoldViewer.jsx`](../client/src/components/ProteinFoldViewer.jsx) embeds
the existing Molstar viewer without writing docking storage. It checks message
origin and source and waits for viewer readiness.

The shared `loadDockingResult` message supports `proteinFormat: mmcif`.
Omitting the format retains PDB behavior for docking.

## Verification

```bash
node scripts/check-openfold-contract.mjs
bun run test:molecule-viewer
bun run test:authed-fetch
bun run build
```

Fixtures establish application behavior, not a successful provider prediction
or scientific accuracy. End-to-end qualification also needs a real authorized
prediction, PDB/mmCIF rendering, result selection, and downloads.

Provider request reference:
[NVIDIA OpenFold3 examples](https://docs.nvidia.com/nim/bionemo/openfold3/1.3.0/example-requests.html).
