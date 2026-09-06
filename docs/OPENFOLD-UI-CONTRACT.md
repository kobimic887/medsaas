# OpenFold3 folding UI contract

Folding remains hosted on NVIDIA. The planned compute box has not been ordered
or received and is not a dependency of this feature.

The existing authenticated `/api/openfold3/predict` proxy forwards the payload
and response. `client/src/utils/openfold.js` builds the UI request and extracts
`outputs[].structures_with_scores[]`. Ligands use `ccd_codes`. Proteins without
a custom CSV MSA use NVIDIA's documented query-only A3M alignment; the UI explains
that a richer alignment may improve prediction. Unique chain IDs and empty custom
alignments are checked before submission.

Each result retains its submitted name and coordinate format, independent of later
form edits. Confidence metrics are shown only when returned as finite numbers;
they are not binding affinities. Responses without structures produce an error,
not a JSON file labelled as a PDB.

`ProteinFoldViewer.jsx` embeds the existing `/molstar/index.html` viewer without
writing docking storage. It checks message origin/source and waits for readiness.
The shared `loadDockingResult` message accepts optional `proteinFormat: mmcif`;
absent values retain the existing PDB default for docking.

Verification: `node scripts/check-openfold-contract.mjs`, frontend build, existing
molecule-viewer lifecycle and authenticated-fetch checks. Contract fixtures are
not evidence of a successful live NVIDIA prediction or scientific accuracy.
A real keyed prediction and browser rendering check remain necessary for full
end-to-end evidence.

Primary contract reference (checked 2026-09-06):
https://docs.nvidia.com/nim/bionemo/openfold3/1.3.0/example-requests.html
