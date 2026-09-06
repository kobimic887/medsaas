// Unit tests for server/utils/stockSearch.js — no server boot, no MongoDB.
//
// Run: SERVER_RUNTIME=bun bun test/stock-search.test.mjs

import {
  buildStockSimilarityUrl,
  createStockDatasetResolver,
  describeStockUpstreamError,
  parseStockSearchQuery,
  relayStockUpstreamStatus,
  stockSearchConfig,
  StockSearchUnavailableError,
  StockSearchValidationError,
  STOCK_DATASET_CACHE_TTL_MS,
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
check('no baseUrl is unavailable', (() => {
  try { buildStockSimilarityUrl({ baseUrl: '', datasetId: 10, smiles: 'x', threshold: 0.5, offset: 0, limit: 10 }); return false; }
  catch (err) { return err instanceof StockSearchUnavailableError; }
})());

console.log('\nstockSearch status relay + error text:\n');

check('upstream 401 → 502 (never a dead user session)', relayStockUpstreamStatus(401) === 502);
check('upstream 403 → 502', relayStockUpstreamStatus(403) === 502);
check('upstream 500 → 502', relayStockUpstreamStatus(500) === 502);
check('upstream 429 → 503 (indistinguishable from the app rate limiter)', relayStockUpstreamStatus(429) === 503);
check('upstream 400 stays 400 (validation)', relayStockUpstreamStatus(400) === 400);
check('detail from upstream validation error surfaces', describeStockUpstreamError(400, { detail: 'SMILES "x" is invalid' }) === 'SMILES "x" is invalid');
check('502 wording is generic and clear', describeStockUpstreamError(502, '') === 'Stock search is temporarily unavailable');

console.log(`\nstockSearch util: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
