import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { moleculePreviewDataUrl } from '../client/src/utils/moleculePreview.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewer = readFileSync(
  path.join(root, 'client/src/pages/dashboard/moleculeviewer.jsx'),
  'utf8',
);

const signalCount = (viewer.match(/signal: controller\.signal/g) || []).length;
const checks = [
  ['3Dmol starts independently from RDKit', viewer.includes('initViewer();\n    initRDKit();')],
  ['viewer initialization no longer waits on an arbitrary timer', !viewer.includes('setTimeout(initializeViewer')],
  ['DiffDock handoff no longer waits on an arbitrary timer', !viewer.includes('setTimeout(checkDiffDockResult')],
  ['stale structure lookups are aborted', viewer.includes('visualizationControllerRef.current?.abort()')],
  ['all remote structure fetches carry the abort signal', signalCount === 4],
  ['remote structure lookup has a bounded timeout', viewer.includes("'Structure lookup timed out', 'TimeoutError'")],
  ['pre-readiness structures are queued with their formats', viewer.includes('pendingMolDataRef.current = { data: molData, formats }')],
  ['DiffDock rendering preserves format fallback', viewer.includes("renderStructure(structureData, ['sdf', 'pdb', 'mol'])")],
  ['example molecules are keyboard-accessible controls', /aria-label=\{`Visualize \$\{mol\.name\}`\}/.test(viewer)],
];

// Exercise real RDKit depiction, including a macrocycle absent from public
// structure registries. Previews must depict the supplied SMILES verbatim.
const require = createRequire(path.join(root, 'server/package.json'));
const rdkit = await require('@rdkit/rdkit')();
for (const smiles of ['C[C@H](O)C(=O)O', 'CN1N=C(C)C=C1C(=O)N1CCC2(CC1)CCCCOCCN(C)C1=NC=CC2=N1']) {
  const url = moleculePreviewDataUrl(rdkit, smiles);
  const svg = decodeURIComponent(url.split(',')[1]);
  checks.push(['exact SMILES renders a 200×150 SVG locally', url.startsWith('data:image/svg+xml;') && svg.includes('<path') && svg.includes("width='200px'") && svg.includes("height='150px'")]);
}
let rejectedInvalid = false;
try { moleculePreviewDataUrl(rdkit, 'not a SMILES'); } catch { rejectedInvalid = true; }
checks.push(['invalid SMILES fails without substitute structures', rejectedInvalid]);
let deleted = false;
let received;
try {
  moleculePreviewDataUrl({ get_mol: (smiles) => {
    received = smiles;
    return { is_valid: () => true, get_svg: () => { throw new Error('depiction failed'); }, delete: () => { deleted = true; } };
  } }, 'C[C@H](O)C(=O)O');
} catch { /* Expected depiction failure. */ }
checks.push(['depiction preserves stereochemistry and frees WASM objects on failure', received === 'C[C@H](O)C(=O)O' && deleted]);

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error('Molecule viewer lifecycle regression check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Molecule viewer lifecycle check passed (${checks.length} invariants)`);
