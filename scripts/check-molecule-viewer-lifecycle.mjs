import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createMoleculePreviewCache, moleculePreviewDataUrl } from '../client/src/utils/moleculePreview.js';

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

// Preview cache: exact-key reuse, shared in-flight work, bounded LRU, retry
// after failure, and no live RDKit molecules retained.
let live = 0;
let parses = 0;
const parsed = [];
const countingRdkit = {
  get_mol(smiles) {
    parses += 1;
    parsed.push(smiles);
    const molecule = rdkit.get_mol(smiles);
    if (!molecule) return molecule;
    live += 1;
    const free = molecule.delete.bind(molecule);
    molecule.delete = () => { live -= 1; free(); };
    return molecule;
  },
};

const cache = createMoleculePreviewCache({ limit: 4, loadRdkit: async () => countingRdkit });
const lactic = 'C[C@H](O)C(=O)O';
const [first, concurrent] = await Promise.all([cache.load(lactic), cache.load(lactic)]);
const repeated = await cache.load(lactic);
checks.push(['concurrent and repeated identical previews render once', parses === 1 && first === concurrent && first === repeated && cache.peek(lactic) === first]);

const variants = ['C[C@@H](O)C(=O)O', 'CC(O)C(=O)O', '[NH4+]', 'N', '[13CH4]', 'C'];
const variantUrls = [];
for (const smiles of variants) variantUrls.push(await cache.load(smiles));
const larger = await cache.load(lactic, { width: 300, height: 220 });
// RDKit draws atom labels as paths, so compare with a direct exact render.
checks.push(['stereo, charge and isotope variants never share an image',
  new Set([first, ...variantUrls]).size === 1 + variants.length
  && variants.every((smiles, i) => variantUrls[i] === moleculePreviewDataUrl(rdkit, smiles))
  && parsed.slice(1, 1 + variants.length).every((smiles, i) => smiles === variants[i])]);
checks.push(['rendering settings are part of the cache key', larger !== first && decodeURIComponent(larger.split(',')[1]).includes("width='300px'")]);
checks.push(['cache stays bounded with least-recently-used eviction', cache.size === 4 && cache.peek(variants[0]) === null && cache.peek(lactic, { width: 300, height: 220 }) === larger]);
checks.push(['cached previews retain no live RDKit molecules', live === 0]);

let attempts = 0;
const flaky = createMoleculePreviewCache({ loadRdkit: async () => {
  attempts += 1;
  if (attempts === 1) throw new Error('RDKit unavailable');
  return rdkit;
} });
let firstFailed = false;
try { await flaky.load(lactic); } catch { firstFailed = true; }
const retried = await flaky.load(lactic).catch(() => null);
checks.push(['a failed preview is not cached and can retry', firstFailed && retried === first && attempts === 2 && flaky.size === 1]);
let invalidRetries = 0;
const invalidCache = createMoleculePreviewCache({ loadRdkit: async () => { invalidRetries += 1; return rdkit; } });
await invalidCache.load('not a SMILES').catch(() => {});
await invalidCache.load('not a SMILES').catch(() => {});
checks.push(['invalid structures are retried, never cached as an image', invalidRetries === 2 && invalidCache.size === 0]);
checks.push(['preview sizes must be whole positive pixels', (() => { try { cache.peek(lactic, { width: 0, height: 150 }); return false; } catch { return true; } })()]);

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error('Molecule viewer lifecycle regression check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Molecule viewer lifecycle check passed (${checks.length} invariants)`);
