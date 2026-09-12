// Unit tests for server/utils/stockSearch.js — no server boot, no MongoDB.
//
// Run: SERVER_RUNTIME=bun bun test/stock-search.test.mjs

import {
  buildStockSimilarityUrl,
  createStockDatasetResolver,
  describeStockUpstreamError,
  parseStockSearchQuery,
  relayStockUpstreamStatus,
  stockSearchCapabilities,
  stockSearchConfig,
  StockSearchUnavailableError,
  StockSearchValidationError,
  DEFAULT_STOCK_FINGERPRINT_TYPE,
  DEFAULT_STOCK_SIMILARITY_METRIC,
  STOCK_DATASET_CACHE_TTL_MS,
  STOCK_FINGERPRINT_LABELS,
  STOCK_FINGERPRINT_TYPES,
  STOCK_SIMILARITY_METRIC_LABELS,
  STOCK_SIMILARITY_METRICS,
} from '../utils/stockSearch.js';

let passed = 0;
let failed = 0;

function check(label, condition, extra = '') {
  if (condition) {
    console.log(`  PASS ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL ${label} ${extra}`);
    failed += 1;
  }
}

console.log('stockSearch config:\n');

check(
  'defaults fall back to TANIMOTO_API_BASE',
  stockSearchConfig({ TANIMOTO_API_BASE: 'http://tanimoto.example:8000/' }).baseUrl ===
    'http://tanimoto.example:8000'
);
check(
  'default dataset name matches the importer',
  stockSearchConfig({}).datasetName === 'Stock compounds — 2026-09-01'
);
check('no id when STOCK_SEARCH_DATASET_ID is unset', stockSearchConfig({}).datasetId === null);
check(
  'numeric STOCK_SEARCH_DATASET_ID is parsed',
  stockSearchConfig({ STOCK_SEARCH_DATASET_ID: '10' }).datasetId === 10
);
check(
  'non-numeric STOCK_SEARCH_DATASET_ID is flagged invalid',
  stockSearchConfig({ STOCK_SEARCH_DATASET_ID: 'ten' }).datasetIdInvalid === true
);
check(
  'STOCK_SEARCH_BASE wins over the Tanimoto fallback',
  stockSearchConfig({ STOCK_SEARCH_BASE: 'http://127.0.0.1:8010', TANIMOTO_API_BASE: 'http://x' }).baseUrl ===
    'http://127.0.0.1:8010'
);

console.log('\nstockSearch dataset resolution:\n');

{
  const config = stockSearchConfig({ STOCK_SEARCH_DATASET_ID: '10' });
  const resolver = createStockDatasetResolver({ config, fetchImpl: async () => { throw new Error('should not fetch'); } });
  const dataset = await resolver.resolve();
  check('pinned id resolves without a listing round-trip', dataset.id === 10 && dataset.pinned === true);
}

{
  // Discovery path with a fresh resolver (no cache): list once, find by name.
  let listCalls = 0;
  const config = stockSearchConfig({ STOCK_SEARCH_BASE: 'http://stub:9', STOCK_SEARCH_DATASET_ID: '' });
  const resolver = createStockDatasetResolver({
    config,
    fetchImpl: async () => {
      listCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          datasets: [
            { id: 3, name: 'Other set', row_count: 10 },
            { id: 10, name: 'Stock compounds — 2026-09-01', row_count: 630646 },
          ],
          count: 2,
        }),
      };
    },
  });
  const first = await resolver.resolve();
  const second = await resolver.resolve();
  check('discovered stock dataset by default name', first.id === 10 && first.name === 'Stock compounds — 2026-09-01');
  check('row count carried through', first.rowCount === 630646);
  check('cache serves the second resolve (one listing)', listCalls === 1);
  check('cached resolve returns same id', second.id === 10);
}

{
  let listCalls = 0;
  const config = stockSearchConfig({ STOCK_SEARCH_BASE: 'http://stub:9', STOCK_SEARCH_DATASET_ID: '' });
  const resolver = createStockDatasetResolver({
    config,
    fetchImpl: async () => {
      listCalls += 1;
      return { ok: true, status: 200, json: async () => ({ datasets: [{ id: 3, name: 'Other set', row_count: 10 }], count: 1 }) };
    },
  });
  let error = null;
  try { await resolver.resolve(); } catch (err) { error = err; }
  check(
    'missing dataset name → StockSearchUnavailableError',
    error instanceof StockSearchUnavailableError && error.status === 503 && /No stock dataset named/.test(error.message)
  );
  check('missing dataset never cached for retry', listCalls === 1);
}

{
  const config = stockSearchConfig({ STOCK_SEARCH_BASE: 'http://stub:9' });
  const resolver = createStockDatasetResolver({
    config,
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  let error = null;
  try { await resolver.resolve(); } catch (err) { error = err; }
  check(
    'unreachable backend → StockSearchUnavailableError',
    error instanceof StockSearchUnavailableError && /unreachable/.test(error.message)
  );
}

{
  // TTL expiry forces a fresh listing.
  let listCalls = 0;
  let nowValue = 1000;
  const config = stockSearchConfig({ STOCK_SEARCH_BASE: 'http://stub:9' });
  const resolver = createStockDatasetResolver({
    config,
    cacheTtlMs: STOCK_DATASET_CACHE_TTL_MS,
    now: () => nowValue,
    fetchImpl: async () => {
      listCalls += 1;
      return { ok: true, status: 200, json: async () => ({ datasets: [{ id: 10, name: config.datasetName, row_count: 630646 }], count: 1 }) };
    },
  });
  await resolver.resolve();
  nowValue += STOCK_DATASET_CACHE_TTL_MS + 1;
  await resolver.resolve();
  check('expired cache re-lists', listCalls === 2);
}

console.log('\nstockSearch query parsing:\n');

{
  const params = parseStockSearchQuery({ smiles: '  c1ccccc1  ' });
  check('defaults: threshold 0.5 offset 0 limit 50', params.threshold === 0.5 && params.offset === 0 && params.limit === 50);
  check('smiles trimmed', params.smiles === 'c1ccccc1');
}
{
  const params = parseStockSearchQuery({ smiles: 'c1ccccc1', threshold: '0.3', offset: '10', limit: '20' });
  check('explicit values parsed', params.threshold === 0.3 && params.offset === 10 && params.limit === 20);
}
check('missing smiles is 400', throwsValidation(() => parseStockSearchQuery({})));
check('blank smiles is 400', throwsValidation(() => parseStockSearchQuery({ smiles: '   ' })));
check('threshold below 0.1 is 400', throwsValidation(() => parseStockSearchQuery({ smiles: 'c1ccccc1', threshold: '0.05' })));
check('threshold above 1 is 400', throwsValidation(() => parseStockSearchQuery({ smiles: 'c1ccccc1', threshold: '1.5' })));
check('negative offset is 400', throwsValidation(() => parseStockSearchQuery({ smiles: 'c1ccccc1', offset: '-1' })));
check('fractional offset is 400', throwsValidation(() => parseStockSearchQuery({ smiles: 'c1ccccc1', offset: '0.5' })));
check('zero limit is 400', throwsValidation(() => parseStockSearchQuery({ smiles: 'c1ccccc1', limit: '0' })));
check('limit clamps to 100', parseStockSearchQuery({ smiles: 'c1ccccc1', limit: '9999' }).limit === 100);

console.log('\nstockSearch fingerprint/metric selectors:\n');

{
  const params = parseStockSearchQuery({ smiles: 'c1ccccc1' });
  check('selectors default to morgan + tanimoto',
    params.fingerprintType === DEFAULT_STOCK_FINGERPRINT_TYPE
    && params.similarityMetric === DEFAULT_STOCK_SIMILARITY_METRIC);
}
{
  const params = parseStockSearchQuery({ smiles: 'c1ccccc1', fingerprint_type: '   ', similarity_metric: '' });
  check('blank/whitespace selectors fall back to defaults',
    params.fingerprintType === 'morgan' && params.similarityMetric === 'tanimoto');
}
{
  const params = parseStockSearchQuery({ smiles: 'c1ccccc1', fingerprint_type: ' maccs ', similarity_metric: 'dice' });
  check('selectors are trimmed and accepted verbatim',
    params.fingerprintType === 'maccs' && params.similarityMetric === 'dice');
}
for (const [field, bad] of [
  ['fingerprint_type', 'foo'],
  ['fingerprint_type', 'ecfp4'],
  ['similarity_metric', 'ctanimoto'],
  ['similarity_metric', 'COUNT_TANIMOTO'],
]) {
  let error = null;
  try { parseStockSearchQuery({ smiles: 'c1ccccc1', [field]: bad }); } catch (err) { error = err; }
  check(`${field}="${bad}" is 400 listing supported values`,
    error instanceof StockSearchValidationError && error.status === 400
    && error.message.includes(`Unsupported ${field}`)
    && error.message.includes('Supported values:'),
    error ? `(got: ${error.message})` : '(no error thrown)');
}

function throwsValidation(fn) {
  try { fn(); return false; } catch (err) { return err instanceof StockSearchValidationError && err.status === 400; }
}

console.log('\nstockSearch URL building:\n');

{
  const url = buildStockSimilarityUrl({
    baseUrl: 'http://stock:8010', datasetId: 10, smiles: 'c1ccccc1', threshold: 0.35, offset: 50, limit: 25,
  });
  const parsed = new URL(url);
  check('URL points at the engine similarity route', parsed.pathname === '/v1/search/similarity');
  check('dataset_id is passed', parsed.searchParams.get('dataset_id') === '10');
  check('offset/limit/threshold passed', parsed.searchParams.get('offset') === '50'
    && parsed.searchParams.get('limit') === '25' && parsed.searchParams.get('threshold') === '0.35');
  check('fingerprint defaults are morgan + tanimoto',
    parsed.searchParams.get('fingerprint_type') === 'morgan' && parsed.searchParams.get('similarity_metric') === 'tanimoto');
}
{
  // Both params are ALWAYS appended — the searched method is pinned in the URL,
  // never assumed by the engine.
  const url = buildStockSimilarityUrl({
    baseUrl: 'http://stock:8010', datasetId: 10, smiles: 'c1ccccc1', threshold: 0.35, offset: 50, limit: 25,
    fingerprintType: 'atom_pair', similarityMetric: 'dice',
  });
  const parsed = new URL(url);
  check('chosen fingerprint/metric are forwarded verbatim',
    parsed.searchParams.get('fingerprint_type') === 'atom_pair' && parsed.searchParams.get('similarity_metric') === 'dice');
}
check('no baseUrl is unavailable', (() => {
  try { buildStockSimilarityUrl({ baseUrl: '', datasetId: 10, smiles: 'x', threshold: 0.5, offset: 0, limit: 10 }); return false; }
  catch (err) { return err instanceof StockSearchUnavailableError; }
})());

console.log('\nstockSearch capabilities (selector allowlist):\n');

{
  const caps = stockSearchCapabilities();
  check('capabilities shape: fingerprintTypes [{value,label}]',
    Array.isArray(caps.fingerprintTypes)
    && caps.fingerprintTypes.length === STOCK_FINGERPRINT_TYPES.length
    && caps.fingerprintTypes.every((o) => typeof o.value === 'string' && typeof o.label === 'string'));
  check('capabilities shape: similarityMetrics [{value,label}]',
    Array.isArray(caps.similarityMetrics)
    && caps.similarityMetrics.length === STOCK_SIMILARITY_METRICS.length
    && caps.similarityMetrics.every((o) => typeof o.value === 'string' && typeof o.label === 'string'));
  check('fingerprint labels are exact',
    STOCK_FINGERPRINT_LABELS.morgan === 'Morgan (ECFP4)'
    && STOCK_FINGERPRINT_LABELS.maccs === 'MACCS keys (166-bit)'
    && STOCK_FINGERPRINT_LABELS.feat_morgan === 'Feature Morgan (FCFP4)'
    && STOCK_FINGERPRINT_LABELS.atom_pair === 'Atom pair'
    && STOCK_FINGERPRINT_LABELS.torsion === 'Topological torsion'
    && STOCK_FINGERPRINT_LABELS.rdkit === 'RDKit path');
  check('metric labels are exact and marked binary',
    STOCK_SIMILARITY_METRIC_LABELS.tanimoto === 'Tanimoto (binary)'
    && STOCK_SIMILARITY_METRIC_LABELS.dice === 'Dice (binary)');
  check('allowlists are frozen and defaults are morgan/tanimoto',
    Object.isFrozen(STOCK_FINGERPRINT_TYPES) && Object.isFrozen(STOCK_SIMILARITY_METRICS)
    && DEFAULT_STOCK_FINGERPRINT_TYPE === 'morgan' && DEFAULT_STOCK_SIMILARITY_METRIC === 'tanimoto');
  check('six verified binary fingerprints, exact order',
    STOCK_FINGERPRINT_TYPES.join(',') === 'morgan,maccs,feat_morgan,atom_pair,torsion,rdkit');
  check('NO count metric is exposed (no value contains count/ctanimoto)',
    STOCK_SIMILARITY_METRICS.every((m) => !/count|ctanimoto/i.test(m)));
}

console.log('\nformula reference — binary vs count similarity (engine-side math, pinned here):\n');

{
  // Binary reference: A=[1,0,1,0], B=[1,1,0,0]. c = shared 1-bits, a = |A|, b = |B|.
  // These formulas run in the ENGINE (tonomitosql tanimoto_sml / dice_sml); this
  // block pins the constants our labels and threshold semantics rely on, and
  // shows why no count variant may be exposed (it is a DIFFERENT score).
  const A = [1, 0, 1, 0];
  const B = [1, 1, 0, 0];
  const c = A.reduce((sum, v, i) => sum + (v === 1 && B[i] === 1 ? 1 : 0), 0);
  const a = A.reduce((s, v) => s + v, 0);
  const b = B.reduce((s, v) => s + v, 0);
  const binaryTanimoto = c / (a + b - c); // c/(a+b−c)
  const binaryDice = (2 * c) / (a + b);   // 2c/(a+b)
  check('binary Tanimoto c/(a+b−c) = 1/3 (c=1, a=2, b=2)',
    c === 1 && a === 2 && b === 2 && binaryTanimoto === 1 / 3);
  check('binary Dice 2c/(a+b) = 1/2', binaryDice === 1 / 2);

  // Count reference (Anna's MOE ctanimoto definition): x=[2,0,1], y=[1,1,0].
  const x = [2, 0, 1];
  const y = [1, 1, 0];
  const sumXY = x.reduce((s, v, i) => s + v * y[i], 0); // Σxy
  const sumX2 = x.reduce((s, v) => s + v * v, 0);       // Σx²
  const sumY2 = y.reduce((s, v) => s + v * v, 0);       // Σy²
  const countTanimoto = sumXY / (sumX2 + sumY2 - sumXY);
  check("Anna count formula Σxy/(Σx²+Σy²−Σxy) = 2/5 (Σxy=2, Σx²=5, Σy²=2) — NOT the binary score",
    sumXY === 2 && sumX2 === 5 && sumY2 === 2 && countTanimoto === 2 / 5);
  const bx = x.map((v) => (v > 0 ? 1 : 0));
  const by = y.map((v) => (v > 0 ? 1 : 0));
  const bc = bx.reduce((s, v, i) => s + (v === 1 && by[i] === 1 ? 1 : 0), 0);
  const binaryReduction = bc / (bx.reduce((s, v) => s + v, 0) + by.reduce((s, v) => s + v, 0) - bc);
  check('the count vector binarized reduces to binary Tanimoto = 1/3', binaryReduction === 1 / 3);
}

console.log('\nstockSearch status relay + error text:\n');

check('upstream 401 → 502 (never a dead user session)', relayStockUpstreamStatus(401) === 502);
check('upstream 403 → 502', relayStockUpstreamStatus(403) === 502);
check('upstream 500 → 502', relayStockUpstreamStatus(500) === 502);
check('upstream 429 → 503 (indistinguishable from the app rate limiter)', relayStockUpstreamStatus(429) === 503);
check('upstream 400 stays 400 (validation)', relayStockUpstreamStatus(400) === 400);
check('detail from upstream validation error surfaces', describeStockUpstreamError(400, { detail: 'SMILES "x" is invalid' }).includes('Check atom charges and bond orders'));
check('502 wording is generic and clear', describeStockUpstreamError(502, '') === 'Stock search is temporarily unavailable');

check("non-chemistry validation retains upstream detail", describeStockUpstreamError(400, { detail: "threshold out of range" }) === "threshold out of range");

console.log(`\nstockSearch util: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

