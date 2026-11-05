import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFoldRequest, foldInputIssues, foldStructures, isGlueComplex, finiteFoldScores, foldHistoryEntities } from '../client/src/utils/openfold.js';
import { buildFixtureFoldResponse } from '../server/utils/foldFixture.js';
const protein = { type: 'protein', id: 'A', sequence: 'MKT V', msaEnabled: false };
const ligand = { type: 'ligand', id: 'B', ligandMode: 'ccd', ccdCode: 'ATP' };
const request = buildFoldRequest([protein, ligand], 'test', 'pdb');
assert.equal(request.inputs[0].molecules[0].msa.main.a3m.alignment, '>query\nMKTV');
assert.equal(request.inputs[0].molecules[1].ccd_codes, 'ATP');
assert.ok(!('ccd_code' in request.inputs[0].molecules[1]));
assert.throws(() => buildFoldRequest([protein, protein], 'test', 'pdb'), /unique/);
assert.throws(() => buildFoldRequest([{ ...protein, msaEnabled: true, msaCsv: '' }], 'test', 'pdb'), /alignment/);
const custom = buildFoldRequest([{ ...protein, msaEnabled: true, msaCsv: 'key,sequence\n-1,MKTV' }], 'test', 'mmcif');
assert.equal(custom.inputs[0].molecules[0].msa.main.csv.format, 'csv');
assert.equal(custom.inputs[0].output_format, 'cif', 'NVIDIA calls mmCIF "cif"');
const { response: demoCif } = buildFixtureFoldResponse(custom, custom.inputs[0].output_format);
assert.ok(demoCif.outputs[0].structures_with_scores[0].structure.startsWith('data_'), 'demo accepts the same cif token as the hosted API');

// Two distinct sequences and the exact candidate glue go in one hosted request.
const secondProtein = { ...protein, id: 'B', sequence: 'ACDEFGHIKLMNPQRSTVWY' };
const glue = { type: 'ligand', id: 'L', ligandMode: 'smiles', smiles: 'N[C@@H](C)C(=O)O' };
const complexEntities = [protein, secondProtein, glue];
const before = structuredClone(complexEntities);
const complex = buildFoldRequest(complexEntities, 'protein-complex-glue', 'pdb', { mode: 'glue' });
assert.deepEqual(complexEntities, before, 'request construction preserves editable inputs');
assert.equal(complex.inputs[0].molecules.length, 3);
assert.deepEqual(complex.inputs[0].molecules.map((molecule) => molecule.id), ['A', 'B', 'L']);
assert.equal(complex.inputs[0].molecules[1].sequence, secondProtein.sequence);
assert.equal(complex.inputs[0].molecules[1].msa.main.a3m.alignment, `>query\n${secondProtein.sequence}`);
assert.equal(complex.inputs[0].molecules[2].smiles, glue.smiles, 'candidate stereochemistry is untouched');
assert.equal(complex.inputs[0].output_format, 'pdb', 'docking-compatible default is preserved');
assert.equal(isGlueComplex(complexEntities), true);
assert.equal(isGlueComplex([protein, ligand]), false);
assert.throws(() => buildFoldRequest([protein, ligand], 'missing-second-protein', 'pdb', { mode: 'glue' }), /two protein chains/);
assert.throws(() => buildFoldRequest([protein, secondProtein], 'missing-glue', 'pdb', { mode: 'glue' }), /candidate ligand/);
assert.throws(() => buildFoldRequest(complexEntities, 'wrong-mode', 'pdb', { mode: 'single' }), /exactly one protein/);
assert.equal(buildFoldRequest([...complexEntities, { ...protein, id: 'C' }], 'larger-complex', 'pdb', { mode: 'glue' }).inputs[0].molecules.length, 4);
assert.ok(foldInputIssues([{ ...protein, sequence: '>chain\nMKTV' }]).some((issue) => issue.includes('FASTA header')));
assert.ok(foldInputIssues([{ ...protein, sequence: 'A'.repeat(4097) }]).some((issue) => issue.includes('4096')));
assert.throws(() => buildFoldRequest([{ ...protein, id: 'A1' }], 'test', 'pdb'), /single-character ID/);
assert.equal(buildFoldRequest([{ ...protein, id: 'A1' }], 'test', 'mmcif').inputs[0].molecules[0].id, 'A1');
assert.throws(() => buildFoldRequest([protein], 'test', 'unknown'), /PDB or mmCIF/);
assert.throws(() => buildFoldRequest([{ ...ligand, ccdCode: 'TOOLONG' }], 'test', 'pdb'), /CCD code/);
assert.equal(buildFoldRequest([{ type: 'rna', id: 'R', sequence: 'ACGU' }], 'rna', 'pdb').inputs[0].molecules[0].msa.main.a3m.alignment, '>query\nACGU');
const pdb = 'ATOM      1  N   MET A   1      11.104  13.207  14.411  1.00 20.00           N\nEND\n';
const cif = 'data_prediction\n#\n';
const results = foldStructures({ outputs: [{ structures_with_scores: [{ structure: pdb, confidence_score: 0, iptm_score: 0.82 }, { structure: cif }] }] }, 'pdb', 'original-request');
assert.equal(results.length, 2);
assert.equal(results[0].text, pdb);
assert.equal(results[0].scores.confidence_score, 0);
assert.equal(results[1].format, 'mmcif');
assert.equal(results[1].name, 'original-request-2');
assert.equal(foldStructures({ outputs: [{ structures_with_scores: [{ structure: '# coordinates', format: 'cif' }] }] }, 'cif', 'cif-result')[0].format, 'mmcif');
assert.deepEqual(foldStructures({ outputs: [{ error: 'failed' }] }, 'pdb', 'test'), []);
// Execute the page's real save function with a captured fetch: prediction and
// sample metadata both use runName, and saving must preserve coordinates.
const page = readFileSync(new URL('../client/src/pages/dashboard/protein-folding.jsx', import.meta.url), 'utf8');
const saveSource = page.match(/const autosaveResult = async \(structures, meta\) => \{[\s\S]*?\n {2}\};/)?.[0];
assert.ok(saveSource, 'folding page save function is present');
let posted;
const states = [];
const makeSave = new Function('historyProbeRef', 'saveSequenceRef', 'mountedRef', 'foldHistoryEntities', 'finiteFoldScores', 'MAX_MSA_TO_SAVE', 'setHistoryRevision', 'setEnvStatus', 'setSaveState', 'setSaveMessage', 'API_CONFIG', 'apiHeaders', 'fetch', `${saveSource}\nreturn autosaveResult;`);
let revisions = 0;
const save = makeSave({ current: Promise.resolve() }, { current: 0 }, { current: true }, foldHistoryEntities, finiteFoldScores, 200000, () => revisions++, () => {}, state => states.push(state), () => {}, { buildApiUrl: path => `/api${path}` }, () => ({}), async (url, options) => {
  posted = { url, payload: JSON.parse(options.body) };
  return { ok: true, json: async () => ({}) };
});
for (const runName of ['Named prediction', 'Sample structure']) {
  await save([{ name: 'model', format: 'pdb', text: pdb, scores: { confidence_score: 0, iptm_score: 0.8, structure: pdb, ptm_score: Infinity } }], { runName, requestId: 'request', outputFormat: 'pdb', entities: [{ ...protein, msaEnabled: true, msaCsv: 'A'.repeat(200001) }] });
  assert.equal(posted.url, '/api/folding-history');
  assert.equal(posted.payload.name, runName);
  assert.equal(posted.payload.structures[0].text, pdb);
  assert.deepEqual(posted.payload.structures[0].scores, { confidence_score: 0, iptm_score: 0.8 });
  assert.equal(posted.payload.request.entities[0].msaCsv, '');
  assert.equal(posted.payload.request.entities[0].msaEnabled, true);
  assert.equal(posted.payload.request.entities[0].msaOmitted, true);
}
assert.deepEqual(states, ['saving', 'saved', 'saving', 'saved']);
assert.equal(revisions, 2);
const longMsa = 'A'.repeat(200001);
assert.equal(buildFoldRequest([{ ...protein, msaEnabled: true, msaCsv: longMsa }], 'long-msa').inputs[0].molecules[0].msa.main.csv.alignment, longMsa);
assert.match(page, /entities: entities\.map\(\(e\) => \(\{ \.\.\.e \}\)\)/, 'prediction snapshot retains full inputs');
const cancelSource = page.match(/const handleCancel = \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
let cancelledLoading = true;
let aborted = false;
const cancelRef = { current: { abort: () => { aborted = true; } } };
new Function('cancelRequestedRef', 'requestControllerRef', 'setLoading', 'setError', `${cancelSource}\nhandleCancel();`)({ current: false }, cancelRef, value => { cancelledLoading = value; }, () => {});
assert.equal(aborted, true);
assert.equal(cancelledLoading, false);
assert.equal(cancelRef.current, null);
const materializeSource = page.match(/function materializeEntity\(entity\) \{[\s\S]*?\n\}/)?.[0];
const materialize = new Function('createEntity', 'getNextChainId', `${materializeSource}\nreturn materializeEntity;`)((type, id) => ({ type, id, msaEnabled: false }), () => 'A');
const reused = materialize({ type: 'protein', id: 'AB12', sequence: 'GG', msaEnabled: true, msaCsv: '', msaOmitted: true });
assert.equal(reused.id, 'AB12');
assert.equal(reused.msaEnabled, true);
assert(foldInputIssues([reused], { outputFormat: 'mmcif' }).some(issue => issue.includes('custom alignment')));
assert.match(page, /const reuseHistoryInputs = async \(row\) => \{[\s\S]*?await fetchHistoryRun\(row\)/, 'reuse fetches the full run');
assert.match(page, /requestControllerRef\.current === controller/, 'old predictions cannot clear current loading state');
const reuseSource = page.match(/const reuseHistoryInputs = async \(row\) => \{[\s\S]*?\n {2}\};/)?.[0];
let reusedEntities;
let fetchedId;
const ignore = () => {};
const reuse = new Function('fetchHistoryRun', 'materializeEntity', 'createEntity', 'isGlueComplex', 'setEntities', 'setMode', 'setRequestId', 'setOutputFormat', 'setRunName', 'setError', 'setSaveState', 'setSaveMessage', 'setSampleNotice', 'window', `${reuseSource}\nreturn reuseHistoryInputs;`)(
  async row => { fetchedId = row.runId; return { name: 'Saved run', outputFormat: 'mmcif', entities: [{ type: 'protein', id: 'AB12', sequence: 'GG' }] }; },
  materialize, () => ({ type: 'protein', id: 'A' }), isGlueComplex, entities => { reusedEntities = entities; },
  ignore, ignore, ignore, ignore, ignore, ignore, ignore, ignore, { scrollTo: ignore });
await reuse({ runId: 'metadata-only-row' });
assert.equal(fetchedId, 'metadata-only-row');
assert.equal(reusedEntities[0].sequence, 'GG');
assert.equal(reusedEntities[0].id, 'AB12');

console.log('OpenFold contract: multi-protein/glue request, input refusal, exact ligand, query/custom MSA, cif normalization, results and download identity passed');
