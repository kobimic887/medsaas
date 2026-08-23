import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const simulation = readFileSync(
  path.join(root, 'client/src/pages/dashboard/simulation.jsx'),
  'utf8',
);
const emptyResponseFallbacks = (
  simulation.match(/responseText\.trim\(\) \? JSON\.parse\(responseText\) : \[\]/g) || []
).length;

const checks = [
  ['browse requests have an abort controller', simulation.includes('const browseControllerRef = useRef(null)')],
  ['search requests have an abort controller', simulation.includes('const searchControllerRef = useRef(null)')],
  ['route cleanup aborts browse work', simulation.includes('browseControllerRef.current?.abort();')],
  ['route cleanup aborts search work', simulation.includes('searchControllerRef.current?.abort();')],
  ['new searches start from cursor zero', simulation.includes('const fromId = 0;')],
  ['new searches do not read the stale cursor', !simulation.includes('const fromId = lastFromId;')],
  ['catalog fetches carry cancellation signals', simulation.includes('signal: controller.signal')],
  ['a new search disables old infinite-scroll state', simulation.includes('isSearchActiveRef.current = false;')],
  ['search errors remain visible until the next search', !simulation.includes('setSearchError("");\n      }, 2000')],
  ['wrapped result arrays stay arrays', simulation.includes('Array.isArray(result.data)')],
  ['catalog result shapes share one normalizer', simulation.includes('resultRows.map(normalizeCatalogMolecule)')],
  ['BAS codes outrank numeric row IDs for checkout', simulation.includes('molecule.BAS_CODE || molecule.bas_code || molecule.basCode || molecule.ASINEX_ID')],
  ['empty successful search pages are treated as no matches', emptyResponseFallbacks === 2],
  ['blank search queries stay disabled', simulation.includes('!searchCode.trim()')],
  ['pre-search and no-match states are distinct', simulation.includes('No molecules matched this search.') && simulation.includes('Enter a molecule identifier or structure above')],
  ['search errors do not also show an empty-state prompt', simulation.includes('!topError && !searchError && topMolecules.length === 0')],
  ['simulation feedback is rendered instead of discarded', simulation.includes('{message && (') && simulation.includes('showMessage(`Added ') && simulation.includes('to cart`);')],
  ['copy failures do not block the browser', !simulation.includes('alert(')],
  ['selection fallbacks stay stable across renders', simulation.includes('const moleculeId = moleculeSelectionId(mol, index)') && simulation.includes('handleCheckboxChange(mol, idx, e.target.checked)')],
  ['structure preview never mutates SMILES for fallback images', !simulation.includes("replace(/[^\\w")],
  ['retired API playground state is absent', !simulation.includes("'/api/hello'") && !simulation.includes('_fetchApiData')],
  ['SMILES copy uses the shared clipboard helper', simulation.includes("import { copyToClipboard } from '@/utils/copyToClipboard'")],
];

const { copyToClipboard } = await import(
  pathToFileURL(path.join(root, 'client/src/utils/copyToClipboard.js')).href
);

const copied = [];
const removed = [];
const fakeTextarea = {
  value: '',
  style: {},
  focus: () => {},
  select: () => {},
  setSelectionRange: () => {},
  setAttribute: () => {},
  remove: () => { removed.push(true); },
};
const fakeDocument = {
  body: { appendChild: (node) => { copied.push(node.value); } },
  createElement: () => fakeTextarea,
  execCommand: (command) => command === 'copy',
};
const firstClickDenied = {
  navigator: {
    clipboard: {
      writeText: async () => {
        throw Object.assign(new Error('Document is not focused.'), { name: 'NotAllowedError' });
      },
    },
  },
  window: { isSecureContext: true, focus() {} },
  document: fakeDocument,
};

await copyToClipboard('CCO', firstClickDenied);
const firstClickRecovers = copied.includes('CCO') && removed.length === 1;

checks.push(['first-click Clipboard API rejection still copies via execCommand', firstClickRecovers]);

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error('Simulation search lifecycle regression check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Simulation search lifecycle check passed (${checks.length} invariants)`);
