import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import {
  attachmentMappingLines, defaultHydrogenChoice, formatQuerySelection, formatUnsupported, hydrogenClickHint, hydrogenOptions, hydrogenParent, receptorPocket,
  refinementRows, releaseViewerCanvases, resultFileName, sdfCoordinates, selectionForAtom, selectionLabel, selectionPayload, selectionReady, unavailableReasons,
} from '../client/src/utils/linkFragmentsJobs.js';
import { linkFragmentsRequest } from '../client/src/utils/linkFragmentsRequest.js';

const page = readFileSync(new URL('../client/src/pages/dashboard/link-fragments.jsx', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../client/src/components/Fragment3DViewer.jsx', import.meta.url), 'utf8');
const querySdf = readFileSync(new URL('../services/link-fragments/fixtures/query.sdf', import.meta.url), 'utf8');

// 1. Request helper: bearer auth, exact bodies, status/code/details, timeout.
const received = [];
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  received.push({ url: req.url, method: req.method, authorization: req.headers.authorization, body });
  if (req.url === '/timeout') return;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/invalid') { res.statusCode = 400; res.end(JSON.stringify({ error: 'Pick an atom that can accept a bond.', code: 'LINK_FRAGMENTS_INVALID_INPUT', details: [{ code: 'NO_HYDROGEN', message: 'Atom 2 has no hydrogen.' }] })); }
  else if (req.url === '/queue') { res.statusCode = 429; res.end(JSON.stringify({ error: 'Too many searches are queued.', code: 'LINK_FRAGMENTS_QUEUE_FULL' })); }
  else if (req.url === '/busy') { res.statusCode = 429; res.end(JSON.stringify({ error: 'You already have a linker scan queued or running.', code: 'LINK_FRAGMENTS_OWNER_BUSY', jobId: '0b5f8f0e-6f4c-4c7e-9a51-3c1d2e4f5a6b' })); }
  else if (req.url === '/jobs') { res.statusCode = 202; res.end(JSON.stringify({ job: { id: 'j1', state: 'queued' } })); }
  else res.end(JSON.stringify({ available: true }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  await linkFragmentsRequest(`${base}/status`, { controller: new AbortController(), token: 'fixture-token' });
  const query = { sdf: querySdf, attachments: [1, { atom: 6, hydrogenAtom: 7 }], limit: 20, maxRmsd: 0.75 };
  const created = await linkFragmentsRequest(`${base}/jobs`, { controller: new AbortController(), token: 'fixture-token', body: query });
  assert.equal(created.job.id, 'j1', '202 Accepted is a success');
  await linkFragmentsRequest(`${base}/cancel`, { controller: new AbortController(), token: 'fixture-token', body: {} });
  assert.equal(received[0].authorization, 'Bearer fixture-token');
  assert.deepEqual(JSON.parse(received[1].body), query, 'exact uploaded 3D text and original-number selections survive requests');
  assert.equal(received[2].method, 'POST');
  const invalid = await linkFragmentsRequest(`${base}/invalid`, { controller: new AbortController() }).catch(error => error);
  assert.match(invalid.message, /Pick an atom/); assert.equal(invalid.status, 400); assert.equal(invalid.code, 'LINK_FRAGMENTS_INVALID_INPUT');
  assert.equal(invalid.details[0].code, 'NO_HYDROGEN');
  const full = await linkFragmentsRequest(`${base}/queue`, { controller: new AbortController() }).catch(error => error);
  assert.equal(full.status, 429); assert.equal(full.code, 'LINK_FRAGMENTS_QUEUE_FULL'); assert.equal(full.jobId, null);
  const busy = await linkFragmentsRequest(`${base}/busy`, { controller: new AbortController() }).catch(error => error);
  assert.equal(busy.status, 429); assert.equal(busy.code, 'LINK_FRAGMENTS_OWNER_BUSY');
  assert.equal(busy.jobId, '0b5f8f0e-6f4c-4c7e-9a51-3c1d2e4f5a6b', 'owner-busy carries the running job id so the page can show it');
  await assert.rejects(linkFragmentsRequest(`${base}/timeout`, { controller: new AbortController(), timeout: 10 }), /timed out/);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

// 2. Attachment selection in original numbering, including explicit H.
// Mirrors the merged /inspect shape for fixtures/query.sdf fragment 2.
const fragment2 = { name: '7WH5.A', atoms: [
  { number: 1, element: 'C', eligible: true, reason: null, implicitHydrogens: 3, explicitHydrogens: [], recommendedHydrogenAtom: null },
  { number: 2, element: 'C', eligible: false, reason: 'No hydrogen available to replace.', implicitHydrogens: 0, explicitHydrogens: [], recommendedHydrogenAtom: null },
  { number: 3, element: 'C', eligible: false, reason: 'No hydrogen available to replace.', implicitHydrogens: 0, explicitHydrogens: [], recommendedHydrogenAtom: null },
  { number: 4, element: 'C', eligible: true, reason: null, implicitHydrogens: 0, explicitHydrogens: [5], recommendedHydrogenAtom: 5 },
  { number: 5, element: 'H', eligible: false, reason: 'Select heavy atom 4 to replace this hydrogen.', implicitHydrogens: 0, explicitHydrogens: [], recommendedHydrogenAtom: null },
  { number: 6, element: 'C', eligible: true, reason: null, implicitHydrogens: 0, explicitHydrogens: [7], recommendedHydrogenAtom: 7 },
  { number: 7, element: 'H', eligible: false, reason: 'Select heavy atom 6 to replace this hydrogen.', implicitHydrogens: 0, explicitHydrogens: [], recommendedHydrogenAtom: null },
] };
const atom6 = fragment2.atoms[5];
assert.equal(defaultHydrogenChoice(atom6), 7, 'explicit-H-only atom defaults to its recommended H');
assert.deepEqual(hydrogenOptions(atom6), [{ value: 7, label: 'Explicit H7 (recommended)' }]);
assert.deepEqual(selectionForAtom(fragment2, 6), { atom: 6, hydrogen: 7 }, 'regression: fragment 2 atom 6 with explicit H7 is selectable');
assert.deepEqual(selectionForAtom(fragment2, 7), { atom: 6, hydrogen: 7 }, 'clicking explicit H7 selects its heavy atom and that H');
assert.deepEqual(selectionPayload(selectionForAtom(fragment2, 7)), { atom: 6, hydrogenAtom: 7 });
assert.equal(selectionForAtom(fragment2, 2), null, 'ineligible atoms cannot be selected from the viewer');
assert.equal(selectionPayload(selectionForAtom(fragment2, 1)), 1, "Anna's reference atom 1 (implicit H) stays an integer selection");
assert.equal(defaultHydrogenChoice(fragment2.atoms[0]), 'implicit');
assert.match(selectionLabel(fragment2, { atom: 6, hydrogen: 7 }), /Atom 6 · C · replaces explicit H7/);
assert.deepEqual(unavailableReasons(fragment2), [{ reason: 'No hydrogen available to replace.', atoms: [2, 3] }], 'hydrogens are excluded from the unavailable list; heavy atoms grouped by reason');
const mixed = { number: 9, element: 'N', eligible: true, implicitHydrogens: 1, explicitHydrogens: [10, 11], recommendedHydrogenAtom: 11 };
assert.equal(defaultHydrogenChoice(mixed), 'implicit');
assert.deepEqual(hydrogenOptions(mixed).map(option => option.value), ['implicit', 10, 11]);
const unchecked = { number: 6, element: 'C', eligible: null, implicitHydrogens: null, explicitHydrogens: [7], recommendedHydrogenAtom: null };
assert.equal(defaultHydrogenChoice(unchecked), 'auto', 'without eligibility the engine picks the hydrogen');
assert.deepEqual(hydrogenOptions(unchecked).map(option => option.value), ['auto', 7]);
assert.equal(selectionPayload({ atom: 6, hydrogen: 'auto' }), 6);
const ambiguous = { number: 4, element: 'C', eligible: true, implicitHydrogens: 0, explicitHydrogens: [8, 9], recommendedHydrogenAtom: null, requiresHydrogenSelection: true };
assert.equal(defaultHydrogenChoice(ambiguous), null, 'the UI never silently picks a hydrogen the service asks the user to choose');
assert.equal(selectionReady({ atom: 4, hydrogen: null }), false);
assert.equal(selectionPayload({ atom: 4, hydrogen: null }), null);
assert.match(selectionLabel({ atoms: [ambiguous] }, { atom: 4, hydrogen: null }), /choose which hydrogen/);
assert.equal(selectionReady({ atom: 4, hydrogen: 9 }), true);
assert.equal(selectionPayload(null), null);
assert.equal(formatQuerySelection({ atom: 6, hydrogenAtom: 7 }, 1), 'Fragment 2 atom 6 (replacing H7)');
assert.equal(formatQuerySelection(1, 0), 'Fragment 1 atom 1');
// Clicking a hydrogen that cannot start a selection explains why (regression:
// charged/isotope H and H on ineligible atoms used to show a generic message).
const hFragment = { atoms: [
  { number: 1, element: 'C', x: 0, y: 0, z: 0, eligible: false, reason: 'No hydrogen available to replace.', implicitHydrogens: 0, explicitHydrogens: [2] },
  { number: 2, element: 'H', x: 1.09, y: 0, z: 0, eligible: false, reason: 'Select heavy atom 1 to replace this hydrogen.' },
  { number: 3, element: 'N', x: 5, y: 0, z: 0, charge: 1, eligible: true, reason: null, implicitHydrogens: 0, explicitHydrogens: [4] },
  { number: 4, element: 'H', x: 6.02, y: 0, z: 0, eligible: false, reason: null },
  { number: 5, element: 'H', x: 5, y: 1.01, z: 0, charge: 0, isotope: 2, eligible: false, reason: null },
  { number: 6, element: 'H', x: 20, y: 0, z: 0, eligible: false, reason: null },
] };
assert.equal(hydrogenParent(hFragment, 2).number, 1, 'listed explicit H resolves through explicitHydrogens');
assert.equal(hydrogenParent(hFragment, 5).number, 3, 'unlisted H resolves to the nearest heavy atom within 1.3 Å');
assert.equal(hydrogenParent(hFragment, 6), null);
assert.equal(selectionForAtom(hFragment, 2), null);
assert.equal(hydrogenClickHint(hFragment, 2, 0), 'Fragment 1 hydrogen 2 is on atom 1 (C), which cannot be used: No hydrogen available to replace.');
assert.equal(hydrogenClickHint(hFragment, 5, 1), 'Fragment 2 hydrogen 5 is on atom 3 (N); this charged or isotope-labelled hydrogen cannot be replaced automatically. Choose atom 3 to replace one of its other hydrogens.');
assert.match(hydrogenClickHint(hFragment, 6, 0), /not bonded to a heavy atom/);
assert(page.includes('hydrogenClickHint(fragment, number, fragmentIndex)'), 'viewer hydrogen clicks use the parent-aware hint');

// 3. Result detail wording, download names and refinement honesty.
const detail = { linkerId: 'L/12', conformerId: 345, attachments: [
  { fragment: 1, atom: 1, element: 'C', hydrogen: 'implicit', removedHydrogenAtom: null, productAtom: 1 },
  { fragment: 2, atom: 6, element: 'C', hydrogen: 'explicit', removedHydrogenAtom: 7, productAtom: 16 },
] };
assert.deepEqual(attachmentMappingLines(detail), ['Fragment 1 atom 1 C (implicit H replaced) → product atom 1', 'Fragment 2 atom 6 C (H7 replaced) → product atom 16']);
assert.equal(resultFileName(detail), 'pyxis-linker-L_12-conformer-345.sdf');
assert.equal(resultFileName(detail, { forceField: 'MMFF94' }), 'pyxis-linker-L_12-conformer-345-refined-MMFF94.sdf');
const rows = Object.fromEntries(refinementRows({ ok: true, forceField: 'UFF', requestedForceField: 'auto', fallbackReason: 'MMFF94 lacks parameters for B.', converged: false, iterations: 2000, maxIterations: 2000, energyUnits: 'kcal/mol', initialEnergy: 152.3456, finalEnergy: 98.1, restraintEnergy: 0.02, unsupported: [{ forceField: 'MMFF94', atoms: [7], elements: ['B'], reason: 'MMFF94 has no atom types for these elements.' }], fixedAtoms: { count: 20, maxDeviation: 0.00012 }, moved: { atoms: 14, rmsd: 0.42, maxDisplacement: 1.2 }, stereo: { preserved: true }, receptor: { atomsRead: 5000, atomsUsed: 4800, watersRemoved: 200, hetGroups: ['ZN'], clashesBefore: 3, clashesAfter: 0, minHeavyDistanceBefore: 2.1, minHeavyDistanceAfter: 3.05, clashDefinition: 'heavy-atom pairs closer than 0.75 × vdW sum', warnings: [] } }));
assert.equal(rows['Force field'], 'UFF (requested auto)');
assert.equal(rows['Fallback reason'], 'MMFF94 lacks parameters for B.');
assert.match(rows.Converged, /^No — stopped after 2,000 of 2,000 iterations/, 'non-convergence is never hidden');
assert.equal(rows['Force-field energy before'], '152.35 kcal/mol');
// Regression: refine.py object items used to render as raw JSON.
assert.equal(rows['Unsupported parameters'], 'MMFF94: MMFF94 has no atom types for these elements. (product atoms 7; elements B)');
assert.equal(formatUnsupported({ forceField: 'UFF', atoms: [3, 4], elements: ['B', 'Si'], reason: 'UFF lacks parameters.' }), 'UFF: UFF lacks parameters. (product atoms 3, 4; elements B, Si)');
assert.equal(formatUnsupported('B'), 'B');
assert(!formatUnsupported({ unexpected: true }).includes('{'), 'never raw JSON');
assert.equal(rows['Receptor clashes before → after'], '3 → 0');
assert(!JSON.stringify(rows).match(/affinity|binding energy|MOE/i), 'refinement report does not claim affinity or MOE equivalence');
assert.deepEqual(refinementRows({ ok: false, errors: [] }), []);

// 4. Receptor context: whole residues near the ligand, waters removed.
const pdbLine = (serial, name, residue, chain, seq, xyz) => `ATOM  ${String(serial).padStart(5)} ${name.padEnd(4)} ${residue} ${chain}${String(seq).padStart(4)}    ${xyz.map(value => value.toFixed(3).padStart(8)).join('')}  1.00  0.00           C`;
const ligand = sdfCoordinates(querySdf);
assert.equal(ligand.length, 11 + 18, 'every atom of both records, explicit H included');
assert.deepEqual(ligand[0], [-16.71, -10.533, 36.901]);
const pdb = [
  pdbLine(1, 'CA', 'ALA', 'A', 10, [-16, -10, 38]), pdbLine(2, 'CB', 'ALA', 'A', 10, [-30, -30, 30]),
  pdbLine(3, 'CA', 'GLY', 'A', 50, [40, 40, 40]),
  pdbLine(4, 'O', 'HOH', 'W', 1, [-16, -10, 37]),
  'HETATM    5 ZN    ZN A 900     -12.000 -15.000  31.000  1.00  0.00          ZN',
].join('\n');
const pocket = receptorPocket(pdb, ligand, 8);
assert.equal(pocket.residues, 2); assert.equal(pocket.atoms, 3, 'near residue kept whole (including its far atom), metal kept, far residue and water dropped');
assert(!pocket.pdb.includes('HOH') && pocket.pdb.includes(' ZN ') && pocket.pdb.endsWith('END\n'));
assert.deepEqual(receptorPocket('', ligand), { pdb: '', residues: 0, atoms: 0 });

// 5. Viewer release: each unmount frees its WebGL context (browsers cap live contexts).
{
  const lost = []; const removed = [];
  const canvas = name => ({ getContext: type => type === 'webgl' ? { getExtension: ext => ext === 'WEBGL_lose_context' ? { loseContext: () => lost.push(name) } : null } : null, remove: () => removed.push(name) });
  releaseViewerCanvases({ querySelectorAll: () => [canvas('a'), canvas('b')] });
  assert.deepEqual(lost, ['a', 'b']); assert.deepEqual(removed, ['a', 'b']);
  releaseViewerCanvases(null);
}
assert(viewer.includes('releaseViewerCanvases(element)') && viewer.includes('const element = container.current;'), 'viewer releases WebGL on unmount using the captured element');
assert(page.includes("{productView && <Fragment3DViewer querySdf={jobQuerySdf} {...productView} loading={detailState.busy ? 'Loading product…' : ''} />}") && !/\{detail && <>\s*\{refinement && <fieldset[\s\S]*?<Fragment3DViewer/.test(page), 'product viewer stays mounted while another product loads');

// 6. Structural rules that are not expressible as pure helpers.
assert(!page.includes("request('search'") && page.includes("request('jobs', controller, { sdf, attachments: selections.map(selectionPayload)"), 'searches are background jobs with original-number selections');
assert(page.includes('file.size > MAX_SDF_BYTES') && page.includes('file.size > MAX_RECEPTOR_BYTES') && page.includes('data.fragments.length !== 2'), 'query and receptor uploads have size/record limits');
assert(page.includes('not equivalent to MOE refinement') && page.includes('does not estimate binding affinity or synthesis feasibility'), 'refinement disclaimer is visible');
assert(page.includes('all uploaded fragment atoms (heavy atoms and uploaded explicit hydrogens) held fixed') && !page.includes('uploaded fragment heavy atoms held fixed'), 'refinement text names every fixed uploaded atom');
assert(page.includes('A search covers replacement of the selected hydrogen only.'), 'attachment scope is stated near the selectors');
assert(!page.includes('upload the SDF again') && page.includes('Uploading an SDF starts a new query and removes this search from the page, so download any products you need first.'), 'resumed note never invites an upload that erases the job');
const receptorInput = page.indexOf('accept=".pdb,chemical/x-pdb"');
assert(receptorInput > 0 && receptorInput < page.indexOf('id="fragment-results-heading"') && page.split('accept=".pdb,chemical/x-pdb"').length === 2, 'one receptor control, outside the product detail block');
assert(page.includes('>Remove receptor</button>') && /clearReceptor\(\); \/\/ a receptor belongs to the previous query/.test(page), 'receptor can be removed and a new SDF clears it');
assert(page.includes('REFINE_REQUEST_TIMEOUT_MS);') && !page.includes('130000'), 'client refinement timeout comes from the shared ordering constant');
assert(page.includes("new Blob([text], { type: 'chemical/x-mdl-sdfile' })") && !page.includes('addShopPack'), 'assembled SDF is downloadable without inventing a catalog purchase');
assert(viewer.includes("withAppBase('/3dmol/3Dmol-min.js')") && viewer.includes('keepH: true') && viewer.includes('atom.index + 1'), 'local 3D viewer preserves original numbering including explicit hydrogens');
assert(!viewer.includes('get_mol') && !viewer.includes('generate') && viewer.includes("v.addModel(productSdf, 'sdf'") && viewer.includes("v.addModel(receptorPdb, 'pdb')"), 'query, product and receptor coordinates are rendered without new conformers or conversion');
console.log('✓ Link Fragments UI: authenticated job requests, explicit-H selection (fragment 2 atom 6/H7), original-number mapping, refinement honesty and receptor pocket checks passed');
