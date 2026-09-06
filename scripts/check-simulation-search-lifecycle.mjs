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

// ── Stock-compound search integrated into the Simulation result list ─────────
// The stock corpus is a second SOURCE in the same screen (not a link to Deep
// Similarity). These invariants protect: honest source switching (never a silent
// corpus fallback), offset pagination over the engine ranking (never a parsed
// compound code), a clear unprovisioned state, and stock rows that never get
// dressed up as purchasable Asinex rows.

checks.push(
  ['stock source posts to the authenticated stock endpoint', simulation.includes("/stock-search/similarity")],
  ['stock availability is probed via the status endpoint', simulation.includes("/stock-search/status")],
  ['stock search is similarity-only and restarts at offset zero', simulation.includes("const progressed = await runStockSearch(0, false,")],
  ['stock pagination advances by offset, never a parsed code', simulation.includes('stockOffsetRef.current = offsetStart + rows.length;') && simulation.includes('stockOffsetRef.current = 0;')],
  ['ASINEX paging cursor is the numeric row id, not the parsed display code', simulation.includes('const parsed = Number(molecule.id);')],
  ['score-ranked similarity is not paged by an unproven id cursor', simulation.includes("method !== 'similarity' && formattedMolecules.length >= pageSize")],
  ['switching the corpus aborts in-flight work and clears results', simulation.includes('const handleSourceChange = (nextSource) =>') && simulation.includes('searchControllerRef.current?.abort();') && simulation.includes('setTopMolecules([]);')],
  ['unprovisioned stock search is a visible state, not a fallback', simulation.includes('Stock-compound search is not available yet') && simulation.includes('switch the source above')],
  ['stock rows are clearly labelled as not purchasable here', simulation.includes('not purchasable in this flow')],
  ['stock snapshot quantities are labelled as dated snapshots', simulation.includes('Dated snapshot quantity from the supplier export')],
  ['stock empty/error states are distinct from the catalog', simulation.includes('No stock compounds matched this structure at the current threshold')],
);

// Pure row-mapping checks against REAL engine payloads captured 2026-09-06 from
// the isolated scratch stack on oracleOld (:8010, dataset 10) — see
// server/test/stock-search-route.test.mjs for the provenance note. This proves
// the client mapper preserves stock codes/IDs as strings and never invents
// Asinex fields, without needing a browser.
const { stockResultsFromPayload } = await import(
  pathToFileURL(path.join(root, 'client/src/utils/stockResults.js')).href
);
const fixtureDir = path.join(root, 'server/test/fixtures');
const page1Payload = JSON.parse(readFileSync(path.join(fixtureDir, 'stock-similarity-benzoic-page1.json'), 'utf8'));
const emptyPayload = JSON.parse(readFileSync(path.join(fixtureDir, 'stock-similarity-empty.json'), 'utf8'));

const mappedRows = stockResultsFromPayload(page1Payload);
const firstRow = mappedRows[0];
checks.push(
  ['real scratch page maps to one Simulation row per engine hit', mappedRows.length === page1Payload.results.length],
  ['stock code survives mapping as a string with its prefix', firstRow && /^[A-Z]+ \d+$/.test(firstRow.stockCode) && firstRow.ASINEX_ID === firstRow.stockCode],
  ['structure survives mapping into the card SMILES field', firstRow && typeof firstRow.SMILES_STRING === 'string' && firstRow.SMILES_STRING.length > 0],
  ['similarity score survives as a number', firstRow && typeof firstRow.SIMILARITY === 'number'],
  ['stock rows are flagged and never gain Asinex price/IUPAC fields', mappedRows.every((row) => row.isStockRow === true && row.PRICE_1MG === undefined && row.IUPAC_NAME === undefined)],
  ['empty engine page maps to no rows', stockResultsFromPayload(emptyPayload).length === 0],
);

{
  // Leading-zero stock IDs are strings end to end (ASN 04188606 must never
  // become the number 4188606 or 0 in a card/selection key).
  const row = stockResultsFromPayload({
    found: true, count: 1, query_smiles: 'CCO',
    results: [{
      molecule_id: 999, canonical_smiles: 'CCO', similarity: 1,
      metadata: { ID: '04188606', MAIN_BAS: 'ASN 04188606', compound_id: 'ASN 04188606', CURRENT_TOT_AMOUNT_UM: '2012', CURRENT_TOT_NETTO_MG: '277.89999' },
    }],
  })[0];
  checks.push(
    ['leading-zero stock IDs stay strings (ASN 04188606)', row && row.stockCode === 'ASN 04188606' && row.ASINEX_ID === 'ASN 04188606'],
    ['database row id is kept separate from the stock code', row && row.stockRowId === 999],
  );
}

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error('Simulation search lifecycle regression check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Simulation search lifecycle check passed (${checks.length} invariants)`);
