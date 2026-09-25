import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const simulation = readFileSync(
  path.join(root, 'client/src/pages/dashboard/simulation.jsx'),
  'utf8',
);
const stockOffersUtil = readFileSync(
  path.join(root, 'client/src/utils/stockOffers.js'),
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
  // Catalog checkout identity moved into the shared offers util
  // (catalogOfferCode / cartItemFromCatalogPrice); the page must use it and
  // must not re-derive catalog identity inline.
  ['BAS codes outrank numeric row IDs for checkout (shared catalogOfferCode)', stockOffersUtil.includes('molecule.BAS_CODE || molecule.bas_code || molecule.basCode') && stockOffersUtil.includes('|| molecule.ASINEX_ID || molecule.id_number || molecule.id') && simulation.includes('cartItemFromCatalogPrice')],
  ['catalog rows carry the catalog pack prices from their own browse/search response', simulation.includes('PRICE_1MG: molecule.PRICE_1MG ?? molecule.price_1mg')],
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
const { workbookPacksForRow } = await import(
  pathToFileURL(path.join(root, 'client/src/utils/compoundPriceGuide.js')).href
);
checks.push(
  ['workbook row mapping uses LAS and stock-other separately', workbookPacksForRow('stock', 'LAS 001')?.packs[0]?.eur === 226 && workbookPacksForRow('stock', 'ASN 001')?.packs[0]?.eur === 170],
  ['RPX and VPX rows use their own tiers and only three pack sizes', workbookPacksForRow('real', 'RPX 001')?.packs.length === 3 && workbookPacksForRow('real', 'RPX 001')?.packs[0]?.eur === 317 && workbookPacksForRow('virtual', 'VPX 001')?.packs[0]?.eur === 400],
  ['unexpected source prefixes cannot acquire a workbook price', workbookPacksForRow('stock', 'VPX 001') === null && workbookPacksForRow('real', 'LAS 001') === null],
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
  ['stock rows render no purchase or pricing UI', !simulation.includes('>Purchase</') && !simulation.includes('stockOffersByCode') && !simulation.includes('/stock-offers')],
  ['stock snapshot quantities are labelled as dated snapshots', simulation.includes('Dated snapshot quantity from the supplier export')],
  ['stock empty/error states are distinct from the catalog', simulation.includes('No stock compounds matched this structure at the current')],
  ['stock row checkboxes share moleculeSelectionId with the docking handoff', simulation.includes('const stockMoleculeId = moleculeSelectionId(mol, idx)')],
  // Fingerprint / metric selectors (binary RDKit only; no count/ctanimoto)
  ['stock fingerprint select is labelled for a11y', simulation.includes('aria-label="Stock fingerprint"')],
  ['stock metric select is labelled for a11y', simulation.includes('aria-label="Stock metric"')],
  ['stock fingerprint/metric state defaults to morgan/tanimoto', simulation.includes("useState('morgan')") && simulation.includes("useState('tanimoto')")],
  ['stock fingerprint/metric refs mirror state', simulation.includes('stockFingerprintTypeRef') && simulation.includes('stockSimilarityMetricRef')],
  ['stock method snapshot ref exists for result banners', simulation.includes('lastStockMethodRef')],
  ['runStockSearch forwards fingerprint_type and similarity_metric', simulation.includes('fingerprint_type: stockFingerprintTypeRef.current') && simulation.includes('similarity_metric: stockSimilarityMetricRef.current')],
  ['stock metric fallback label is Tanimoto (binary)', simulation.includes("'Tanimoto (binary)'")],
  ['stock UI states count-based searching is unavailable', simulation.includes('These are binary fingerprints.')],
  ['stock pagination dedupes by stockRowId via appendUniqueStockRows', simulation.includes('appendUniqueStockRows(prev, rows)')],
  ['hardcoded Morgan/Tanimoto results banner is gone', !simulation.includes('ranked by RDKit Morgan (ECFP4) Tanimoto similarity')],
);

// Pure row-mapping checks against REAL engine payloads captured 2026-09-06 from
// the isolated scratch stack on oracleOld (:8010, dataset 10) — see
// server/test/stock-search-route.test.mjs for the provenance note. This proves
// the client mapper preserves stock codes/IDs as strings and never invents
// Asinex fields, without needing a browser.
const { stockResultsFromPayload, appendUniqueStockRows } = await import(
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

// Execute the real threshold handler to prove it cancels and resets a ranking.
const handlerBody = simulation.split('const handleThresholdChange = (value) => {')[1].split('\n  };')[0];
const calls = [];
const context = {
  searchSourceRef: { current: 'stock' },
  searchControllerRef: { current: { abort() { calls.push('abort'); } } },
  searchRequestIdRef: { current: 7 }, isSearchActiveRef: { current: true },
  isLoadingPageRef: { current: true }, stockOffsetRef: { current: 50 },
  openRankedCacheRef: { current: [{ chemblId: 'stale' }] },
};
for (const name of ['setSimilarityThreshold', 'setStockOffset', 'setIsSearchActive', 'setSearchLoading', 'setTopLoading', 'setHasMore', 'setTopMolecules', 'setSelectedMolecules', 'setSearchError', 'setOpenAiStage', 'setOpenAiExplanation']) context[name] = value => calls.push([name, value]);
new Function(...Object.keys(context), 'value', handlerBody)(...Object.values(context), 0.7);
checks.push(
  ['threshold change aborts the old stock ranking', calls.includes('abort') && context.searchRequestIdRef.current === 8],
  ['threshold change resets paging and old rows', context.stockOffsetRef.current === 0 && !context.isSearchActiveRef.current && calls.some(c => c[0] === 'setTopMolecules' && c[1].length === 0)],
  ['threshold change clears open AI cache', context.openRankedCacheRef.current === null],
  ['returning to stock retries unfinished availability', simulation.includes("if (stockStatusRef.current?.state !== 'available') fetchStockStatus()")],
  ['stock threshold matches API minimum', simulation.includes('searchSource === "stock" ? "0.1"') && simulation.includes('Math.max(0.1, value)')],
);

// Execute handleStockMethodChange the same way — fingerprint/metric changes must
// invalidate the ranking exactly like a threshold change (stock/open reset body).
{
  const methodBody = simulation.split('const handleStockMethodChange = (field, value) => {')[1].split('\n  };')[0];
  const methodCalls = [];
  const methodCtx = {
    searchSourceRef: { current: 'stock' },
    searchControllerRef: { current: { abort() { methodCalls.push('abort'); } } },
    searchRequestIdRef: { current: 3 }, isSearchActiveRef: { current: true },
    isLoadingPageRef: { current: true }, stockOffsetRef: { current: 100 },
    stockFingerprintTypeRef: { current: 'morgan' },
    stockSimilarityMetricRef: { current: 'tanimoto' },
    openRankedCacheRef: { current: [{ chemblId: 'stale' }] },
  };
  for (const name of ['setStockFingerprintType', 'setStockSimilarityMetric', 'setStockOffset', 'setIsSearchActive', 'setSearchLoading', 'setTopLoading', 'setHasMore', 'setTopMolecules', 'setSelectedMolecules', 'setSearchError', 'setOpenAiStage', 'setOpenAiExplanation']) {
    methodCtx[name] = value => methodCalls.push([name, value]);
  }
  new Function(...Object.keys(methodCtx), 'field', 'value', methodBody)(...Object.values(methodCtx), 'fingerprint', 'maccs');
  checks.push(
    ['stock method change aborts the old ranking', methodCalls.includes('abort') && methodCtx.searchRequestIdRef.current === 4],
    ['stock method change resets paging and old rows', methodCtx.stockOffsetRef.current === 0 && !methodCtx.isSearchActiveRef.current && methodCalls.some(c => c[0] === 'setTopMolecules' && c[1].length === 0)],
    ['stock method change updates fingerprint state+ref', methodCalls.some(c => c[0] === 'setStockFingerprintType' && c[1] === 'maccs') && methodCtx.stockFingerprintTypeRef.current === 'maccs'],
    ['stock method change clears open AI cache', methodCtx.openRankedCacheRef.current === null],
  );
}

{
  const existing = [
    { stockRowId: 1, stockCode: 'ASN 1' },
    { stockRowId: 2, stockCode: 'ASN 2' },
  ];
  const incoming = [
    { stockRowId: 2, stockCode: 'ASN 2 dup' },
    { stockRowId: 3, stockCode: 'ASN 3' },
  ];
  const unique = appendUniqueStockRows(existing, incoming);
  checks.push(
    ['appendUniqueStockRows drops duplicate stockRowId across pages', unique.length === 1 && unique[0].stockRowId === 3],
    ['appendUniqueStockRows keeps novel rows', unique[0].stockCode === 'ASN 3'],
  );
}

checks.push(
  ['open source posts to the authenticated open-compounds endpoint', simulation.includes("/open-compounds/similarity")],
  ['open AI search posts to ai-search', simulation.includes("/open-compounds/ai-search")],
  ['open availability is probed via the status endpoint', simulation.includes("/open-compounds/status")],
  ['open search is similarity-only and restarts at offset zero', simulation.includes("runOpenSearch(0, false,") || simulation.includes("runOpenAiSearch({")],
  ['ChEMBL remains an explicit staging source', simulation.includes("{ value: 'open', title: 'Open compounds', detail: 'ChEMBL discovery' }") && simulation.includes('name="searchSource"')],
  ['open threshold floor is 0.4', simulation.includes('searchSource === "open" ? "0.4"') && simulation.includes('Math.max(0.4, value)')],
  ['open export uses authenticated export route', simulation.includes("/open-compounds/export")],
  ['open empty/error states are distinct', simulation.includes('No open compounds matched this structure')],
  ['open rows never claim purchase/stock', simulation.includes('Not stocked or priced')],
  ['explicit Search without AI control exists', simulation.includes('Search without AI')],
  ['AI failure does not pretend deterministic search ran', simulation.includes('did not silently run that path')],
);

checks.push(
  ['staging separates its Pyxis stock, real, virtual and ChEMBL collections from the legacy catalog', simulation.includes("{ value: 'stock', title: 'Stock compounds'") && simulation.includes("{ value: 'real', title: 'Real macrocycles'") && simulation.includes("{ value: 'virtual', title: 'Virtual macrocycles'") && simulation.includes("{ value: 'open', title: 'Open compounds'") && simulation.includes("{ value: 'asinex', title: 'Internal catalog'")],
  ['staging opens the Pyxis stock index while consumer catalog default stays intact', simulation.includes('useState(IS_STAGING_BUILD ? "stock" : "asinex")') && simulation.includes("fetchStockStatus()")],
  ['a non-catalog default settles the browse spinner', simulation.includes("if (searchSourceRef.current === 'asinex') fetchAllMolecules(0, false);") && simulation.includes('setInitialLoading(false);') && simulation.includes('setCatalogSettled(true);')],
  ['macrocycle status and similarity use authenticated routes', simulation.includes("/macrocycles/status") && simulation.includes("/macrocycles/similarity")],
  ['macrocycle search forwards its selected metric with the Morgan fingerprint', simulation.includes("fingerprint_type: 'morgan'") && simulation.includes('similarity_metric: macrocycleSimilarityMetricRef.current')],
  ['macrocycle metric options come from the dataset capabilities', simulation.includes('activeMacrocycleStatus.capabilities?.similarityMetrics') && simulation.includes('macrocycleMetricOptions')],
  ['macrocycle method selector is labelled for a11y', simulation.includes('aria-label="Macrocycle similarity method"')],
  ['macrocycle status clamps the metric to what the dataset can score', simulation.includes('countMetricsAvailable') && simulation.includes("macrocycleSimilarityMetricRef.current = 'tanimoto'")],
  ['macrocycle result banner reports the method that produced the rows', simulation.includes('macrocycleResultMethodLabel') && simulation.includes('macrocycleMetricLabel')],
  ['macrocycle count copy never claims MOE equivalence', simulation.includes('a Pyxis method, not MOE ctanimoto')],
  ['macrocycle rows retain docking handoff without cart controls', simulation.includes('Select structures for docking handoff.') && simulation.includes('WorkbookRowPrices source={searchSource}')],
  ['staging rows show the approved workbook tier beside each hit', simulation.includes('WorkbookRowPrices source="stock"') && simulation.includes('WorkbookRowPrices source={searchSource}') && simulation.includes('Workbook 1–3 selected tier') && simulation.includes('Availability and checkout prices are unconfirmed.')],
  ['query and results are adjacent columns with a wider query panel', simulation.includes('lg:grid-cols-[minmax(25rem,29rem)_minmax(0,1fr)]') && simulation.includes('aria-labelledby="results-heading"')],
  ['results offer explicit pagination in the two-column layout', simulation.includes('Load more results')],
);

{
  // Execute handleMacrocycleMethodChange the same way as the stock one: a metric
  // change defines a new ranking, and a non-macrocycle source is left untouched.
  const macroBody = simulation.split('const handleMacrocycleMethodChange = (value) => {')[1].split('\n  };')[0];
  const buildCtx = (source) => {
    const calls = [];
    const ctx = {
      MACROCYCLE_SOURCES: { real: { label: 'Real macrocycles' }, virtual: { label: 'Virtual macrocycles' } },
      searchSourceRef: { current: source },
      searchControllerRef: { current: { abort() { calls.push('abort'); } } },
      searchRequestIdRef: { current: 5 }, isSearchActiveRef: { current: true },
      isLoadingPageRef: { current: true }, stockOffsetRef: { current: 50 },
      openRankedCacheRef: { current: [{ chemblId: 'stale' }] },
      macrocycleSimilarityMetricRef: { current: 'tanimoto' },
    };
    for (const name of ['setMacrocycleSimilarityMetric', 'setStockOffset', 'setIsSearchActive', 'setSearchLoading', 'setTopLoading', 'setHasMore', 'setTopMolecules', 'setSelectedMolecules', 'setSearchError', 'setOpenAiStage', 'setOpenAiExplanation']) {
      ctx[name] = (value) => calls.push([name, value]);
    }
    return { ctx, calls };
  };
  const active = buildCtx('real');
  new Function(...Object.keys(active.ctx), 'value', macroBody)(...Object.values(active.ctx), 'count_tanimoto');
  checks.push(
    ['macrocycle metric change aborts the old ranking', active.calls.includes('abort') && active.ctx.searchRequestIdRef.current === 6],
    ['macrocycle metric change resets paging and old rows', active.ctx.stockOffsetRef.current === 0 && !active.ctx.isSearchActiveRef.current && active.calls.some((c) => c[0] === 'setTopMolecules' && c[1].length === 0)],
    ['macrocycle metric change updates state and ref', active.calls.some((c) => c[0] === 'setMacrocycleSimilarityMetric' && c[1] === 'count_tanimoto') && active.ctx.macrocycleSimilarityMetricRef.current === 'count_tanimoto'],
    ['macrocycle metric change clears the open AI cache', active.ctx.openRankedCacheRef.current === null],
  );
  const inactive = buildCtx('stock');
  new Function(...Object.keys(inactive.ctx), 'value', macroBody)(...Object.values(inactive.ctx), 'count_tanimoto');
  checks.push(
    ['macrocycle metric change leaves other corpora untouched', inactive.calls.length === 1 && inactive.ctx.stockOffsetRef.current === 50 && inactive.ctx.isSearchActiveRef.current === true],
  );
}

const { macrocycleResultsFromPayload, appendUniqueMacrocycleRows } = await import(
  pathToFileURL(path.join(root, 'client/src/utils/macrocycleResults.js')).href
);
const macroRows = macrocycleResultsFromPayload({ results: [
  { molecule_id: 41, canonical_smiles: 'O=C1NC2C(NCCC2)CC1', similarity: 0.71, metadata: { MAIN_BAS: 'BAS 00132206', web_mg: '12.5', web_uM: '44', Lead_TIME: '28 days', source: 'macrocycle_real' } },
] }, 'real');
const virtualRows = macrocycleResultsFromPayload({ results: [
  { molecule_id: 1, canonical_smiles: 'C1CCCCC1', similarity: 1, metadata: { MAIN_BAS: 'VPX 900000001', web_mg: '', web_uM: '', CURRENT_TOT_NETTO_MG: '5', CURRENT_TOT_AMOUNT_UM: '11.3', Lead_TIME: '28 days' } },
] }, 'virtual');
checks.push(
  ['macrocycle hit preserves source, identity, structure, and numeric score', macroRows.length === 1 && macroRows[0].macrocycleSource === 'real' && macroRows[0].macrocycleCode === 'BAS 00132206' && macroRows[0].SMILES_STRING === 'O=C1NC2C(NCCC2)CC1' && macroRows[0].SIMILARITY === 0.71],
  ['macrocycle dated quantities and lead time survive with caveated labels', macroRows[0].snapshotMg === '12.5' && macroRows[0].snapshotUm === '44' && macroRows[0].snapshotLeadTime === '28 days' && simulation.includes('Dated supplier export; amount and lead time are unverified now')],
  ['virtual export amount fields appear when real-stock columns are blank', virtualRows[0].snapshotMg === '5' && virtualRows[0].snapshotUm === '11.3'],
  ['macrocycle hit cannot enter catalog pricing through row fields', macroRows[0].isMacrocycleRow === true && macroRows[0].PRICE_1MG === undefined && macroRows[0].STOCK_MG === undefined],
  ['macrocycle page append removes duplicate row IDs', appendUniqueMacrocycleRows(macroRows, [...macroRows, { ...macroRows[0], macrocycleRowId: 42 }]).length === 1],
);

checks.push(['stock backend inherits the resolved Tanimoto default', readFileSync(path.join(root, 'server/index.js'), 'utf8').includes('stockSearchConfig({ ...process.env, TANIMOTO_API_BASE })')]);
checks.push(['open compounds routes are registered', readFileSync(path.join(root, 'server/index.js'), 'utf8').includes("/api/open-compounds/similarity")]);
checks.push(['open compounds AI route is registered', readFileSync(path.join(root, 'server/index.js'), 'utf8').includes("/api/open-compounds/ai-search")]);

// Execute the actual request handlers with a rejected engine query. This catches
// the failure-to-catalog transition, rather than only checking source strings.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const searchBody = simulation.split('const handleSearch = async () => {')[1].split('\n  // Function to load more search results')[0].replace(/};\s*$/, '');
const rejectedCalls = [];
const rejectedContext = {
  AbortController, searchCode: '[N](C)(C)(C)C',
  MACROCYCLE_SOURCES: { real: true, virtual: true },
  getAuthToken: () => 'fixture',
  runStockSearch: async () => { throw new Error('RDKit rejected fixture'); },
  runOpenSearch: async () => { throw new Error('should not run open'); },
};
for (const name of new Set(searchBody.match(/\b\w+Ref\b/g))) rejectedContext[name] = { current: null };
rejectedContext.searchSourceRef.current = 'stock';
rejectedContext.hasMoreRef.current = true;
rejectedContext.browseRequestIdRef.current = 0;
rejectedContext.searchRequestIdRef.current = 0;
for (const name of new Set(searchBody.match(/\bset[A-Z]\w*/g))) rejectedContext[name] = value => rejectedCalls.push([name, value]);
await new AsyncFunction(...Object.keys(rejectedContext), searchBody)(...Object.values(rejectedContext));
checks.push(
  ['rejected stock query clears previous visible rows', rejectedCalls.some(([name, value]) => name === 'setTopMolecules' && value.length === 0)],
  ['rejected stock query cannot keep pagination enabled', rejectedContext.hasMoreRef.current === false && !rejectedCalls.some(([name, value]) => name === 'setHasMore' && value === true)],
  ['rejected stock query preserves the actual error', rejectedCalls.some(([name, value]) => name === 'setSearchError' && value.includes('RDKit rejected fixture'))],
);

const rejectedOpenCalls = [];
const rejectedOpenContext = {
  AbortController, searchCode: '[N](C)(C)(C)C',
  MACROCYCLE_SOURCES: { real: true, virtual: true },
  getAuthToken: () => 'fixture',
  runStockSearch: async () => { throw new Error('should not run stock'); },
  runOpenSearch: async () => { throw new Error('ChEMBL rejected fixture'); },
  runOpenAiSearch: async () => { throw new Error('should not run AI'); },
};
for (const name of new Set(searchBody.match(/\b\w+Ref\b/g))) rejectedOpenContext[name] = { current: null };
rejectedOpenContext.searchSourceRef.current = 'open';
rejectedOpenContext.openUseAiRef = { current: false };
rejectedOpenContext.hasMoreRef.current = true;
rejectedOpenContext.browseRequestIdRef.current = 0;
rejectedOpenContext.searchRequestIdRef.current = 0;
for (const name of new Set(searchBody.match(/\bset[A-Z]\w*/g))) rejectedOpenContext[name] = value => rejectedOpenCalls.push([name, value]);
await new AsyncFunction(...Object.keys(rejectedOpenContext), searchBody)(...Object.values(rejectedOpenContext));
checks.push(
  ['rejected open query clears previous visible rows', rejectedOpenCalls.some(([name, value]) => name === 'setTopMolecules' && value.length === 0)],
  ['rejected open query cannot keep pagination enabled', rejectedOpenContext.hasMoreRef.current === false && !rejectedOpenCalls.some(([name, value]) => name === 'setHasMore' && value === true)],
  ['rejected open query preserves the actual error', rejectedOpenCalls.some(([name, value]) => name === 'setSearchError' && value.includes('ChEMBL rejected fixture'))],
);

const rejectedMacroCalls = [];
const rejectedMacroContext = {
  AbortController, searchCode: '[N](C)(C)(C)C',
  MACROCYCLE_SOURCES: { real: true, virtual: true },
  getAuthToken: () => 'fixture',
  runMacrocycleSearch: async () => { throw new Error('Macrocycle query rejected'); },
};
for (const name of new Set(searchBody.match(/\b\w+Ref\b/g))) rejectedMacroContext[name] = { current: null };
rejectedMacroContext.searchSourceRef.current = 'real';
rejectedMacroContext.hasMoreRef.current = true;
rejectedMacroContext.browseRequestIdRef.current = 0;
rejectedMacroContext.searchRequestIdRef.current = 0;
for (const name of new Set(searchBody.match(/\bset[A-Z]\w*/g))) rejectedMacroContext[name] = value => rejectedMacroCalls.push([name, value]);
await new AsyncFunction(...Object.keys(rejectedMacroContext), searchBody)(...Object.values(rejectedMacroContext));
checks.push(
  ['rejected macrocycle query clears results without fallback', rejectedMacroCalls.some(([name, value]) => name === 'setTopMolecules' && value.length === 0) && !rejectedMacroCalls.some(([name, value]) => name === 'setHasMore' && value === true)],
  ['rejected macrocycle query shows its error', rejectedMacroCalls.some(([name, value]) => name === 'setSearchError' && value.includes('Macrocycle query rejected'))],
);

const { openResultsFromPayload } = await import(
  pathToFileURL(path.join(root, 'client/src/utils/openResults.js')).href
);
const openMapped = openResultsFromPayload({
  results: [{
    rank: 1,
    chemblId: 'CHEMBL1373993',
    smiles: 'O=C(O)CSc1nc2ccccc2s1',
    similarity: 1,
    sourceUrl: 'https://www.ebi.ac.uk/chembl/compound_report_card/CHEMBL1373993/',
    sourceLabel: 'ChEMBL',
    inchiKey: 'ZZUQWNYNSKJLPI-UHFFFAOYSA-N',
  }],
});
checks.push(
  ['open mapper keeps ChEMBL id as selection key', openMapped[0]?.ASINEX_ID === 'CHEMBL1373993' && openMapped[0]?.isOpenRow === true],
  ['open mapper never invents prices', openMapped[0]?.PRICE_1MG === undefined],
);

const browseBody = simulation.split('const fetchAllMolecules = async (page = 0, append = false, requestedPageSize = pageSizeRef.current) => {')[1].split('\n  };')[0];
// No fetch mocks: reaching the catalog network code would fail this execution.
await new AsyncFunction('searchSourceRef', 'searchControllerRef', browseBody)({ current: 'stock' }, { current: null });
await new AsyncFunction('searchSourceRef', 'searchControllerRef', browseBody)({ current: 'open' }, { current: null });
await new AsyncFunction('searchSourceRef', 'searchControllerRef', browseBody)({ current: 'asinex' }, { current: {} });
checks.push(['catalog handler refuses stock/open source and pending searches before fetching', true]);

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error('Simulation search lifecycle regression check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Simulation search lifecycle check passed (${checks.length} invariants)`);
