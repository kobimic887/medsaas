// Unified, bounded owned-source searches. Retired supplier namespaces remain
// refused; no missing source ever falls back to a different collection.
import {
  buildStockSimilarityUrl, parseStockSearchQuery, relayStockUpstreamStatus,
} from './stockSearch.js';
import {
  assertMacrocycleMetricSupported, buildMacrocycleSimilarityUrl,
  parseMacrocycleSearchQuery, tagCombinedMacrocycleResults, tagMacrocycleResults,
} from './macrocycleSearch.js';
import {
  chemblMoleculeToCandidate, loadRDKit, runOpenCompoundsSearch,
} from './openCompounds.js';
import { withCompoundShopOffers } from './compoundShopSearch.js';

export const OWNED_SEARCH_SOURCES = ['stock', 'both', 'real', 'virtual', 'open'];
export const OWNED_SEARCH_MODES = ['id', 'exact', 'substructure', 'similarity'];
export const OWNED_SEARCH_MAX_QUERIES = 20;
export const OWNED_SEARCH_MAX_OFFSET = 900;
export class OwnedSearchError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.code = 'OWNED_SEARCH_ERROR'; }
}
export function parseOwnedSearch(body = {}) {
  const { source, mode } = body;
  if (!OWNED_SEARCH_SOURCES.includes(source)) throw new OwnedSearchError('Choose stock, both, real, virtual or open');
  if (!OWNED_SEARCH_MODES.includes(mode)) throw new OwnedSearchError('Choose id, exact, substructure or similarity');
  if (!Array.isArray(body.queries) || !body.queries.length || body.queries.length > OWNED_SEARCH_MAX_QUERIES
    || body.queries.some((query) => typeof query !== 'string' || !query.trim() || query.length > 2000)) {
    throw new OwnedSearchError('Supply 1–20 nonempty queries, at most 2000 characters each');
  }
  const offset = body.offset ?? 0; const limit = body.limit ?? 50;
  if (!Number.isInteger(offset) || offset < 0 || offset > OWNED_SEARCH_MAX_OFFSET
    || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new OwnedSearchError('offset must be 0–900 and limit 1–100');
  const queries = body.queries.map((query) => query.trim());
  let options = {};
  if (mode === 'similarity') {
    if (source === 'open') {
      const threshold = body.threshold ?? 0.5;
      if (!Number.isFinite(threshold) || threshold < 0.4 || threshold > 1) throw new OwnedSearchError('Open similarity threshold must be 0.4–1');
      if (body.fingerprint_type && body.fingerprint_type !== 'morgan') throw new OwnedSearchError('Open compounds supports Morgan only');
      if (body.similarity_metric && body.similarity_metric !== 'tanimoto') throw new OwnedSearchError('Open compounds supports binary Tanimoto only');
      options = { threshold, fingerprintType: 'morgan', similarityMetric: 'tanimoto' };
    } else {
      const parsed = source === 'stock' ? parseStockSearchQuery({ ...body, smiles: queries[0], offset: 0, limit: 100 })
        : parseMacrocycleSearchQuery({ ...body, source, smiles: queries[0], offset: 0, limit: 100 });
      options = { threshold: parsed.threshold, fingerprintType: parsed.fingerprintType, similarityMetric: parsed.similarityMetric };
    }
  }
  return { source, mode, queries, offset, limit, ...options };
}
function identity(row, source) { return source === 'open' ? `open:${row.chemblId}` : `${row.source || source}:${row.molecule_id}`; }
function compare(a, b, mode) {
  if (mode === 'similarity' && a.similarity !== b.similarity) return (b.similarity ?? 0) - (a.similarity ?? 0);
  const rank = { stock: 0, real: 1, virtual: 2, open: 3, chembl: 3 };
  return (rank[a.source] ?? 0) - (rank[b.source] ?? 0)
    || (a.chemblId ? a.chemblId.localeCompare(b.chemblId) : Number(a.molecule_id) - Number(b.molecule_id));
}
export function mergeOwnedSearch(params, responses) {
  const rows = new Map();
  const queries = responses.map((response, index) => {
    for (const hit of response.results || []) {
      const key = identity(hit, params.source); const existing = rows.get(key);
      if (!existing) rows.set(key, { ...hit, matchedQueryIndices: [index] });
      else {
        if (!existing.matchedQueryIndices.includes(index)) existing.matchedQueryIndices.push(index);
        if (params.mode === 'similarity' && hit.similarity > existing.similarity) existing.similarity = hit.similarity;
      }
    }
    return { index, input: params.queries[index], status: response.error ? 'error' : response.results?.length ? 'matched' : 'unmatched',
      ...(response.error ? { error: response.error } : {}), matchCount: response.results?.length || 0, truncated: Boolean(response.truncated) };
  });
  const sorted = [...rows.values()].sort((a, b) => compare(a, b, params.mode));
  const capTruncated = responses.some((response) => response.truncated);
  const page = sorted.slice(params.offset, params.offset + params.limit);
  const hasMore = params.offset + page.length < sorted.length && params.offset + params.limit <= OWNED_SEARCH_MAX_OFFSET;
  return { source: params.source, mode: params.mode, results: page, queries,
    total: sorted.length, totalExact: !capTruncated && !responses.some((response) => response.error),
    offset: params.offset, limit: params.limit, hasMore, truncated: capTruncated,
    maxOffset: OWNED_SEARCH_MAX_OFFSET,
    ...(params.source === 'open' ? { sendsQueryExternally: true, attribution: 'ChEMBL / EMBL-EBI; discovery only' } : {}),
    method: params.mode === 'similarity' ? { fingerprint_type: params.fingerprintType, similarity_metric: params.similarityMetric, threshold: params.threshold }
      : { graphMatch: params.mode, useChirality: true, exactIncludesStereochemistry: true },
  };
}
export function createOwnedSearch({ graphBase, fetchImpl, stockConfig, stockResolver, macroConfig, macroResolver, openConfig, secret, now = Date.now }) {
  async function boundedFetch(url, options = {}, deadline) {
    const remaining = deadline === undefined ? 40000 : deadline - now();
    if (remaining <= 0) throw new OwnedSearchError('Batch exceeded 90 seconds; reduce the number of queries', 503);
    const timeoutMs = Math.min(options.timeoutMs || 40000, 40000, remaining);
    return fetchImpl(url, { ...options, timeoutMs, signal: AbortSignal.timeout(timeoutMs) });
  }
  async function jsonRequest(url, options = {}) {
    const { deadline, ...request } = options;
    let response;
    try { response = await boundedFetch(url, { ...request, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }, deadline); } catch { throw new OwnedSearchError('Search service is unreachable', 502); }
    let payload; try { payload = await response.json(); } catch { throw new OwnedSearchError('Search returned an invalid response', 502); }
    if (!response.ok) throw new OwnedSearchError(payload.error || payload.detail || payload.error_message || 'Search is unavailable', relayStockUpstreamStatus(response.status));
    return payload;
  }
  const graph = (path, body, deadline) => {
    if (!graphBase) throw new OwnedSearchError('Owned graph search is not configured', 503);
    return jsonRequest(`${graphBase.replace(/\/+$/, '')}${path}`, { method: 'POST', body: JSON.stringify(body), deadline });
  };
  async function status(source) {
    if (!OWNED_SEARCH_SOURCES.includes(source)) throw new OwnedSearchError('Invalid source');
    if (source === 'open' && (!openConfig.enabled || !openConfig.baseUrl)) return { available: false, modes: [], maxQueries: 20, reason: 'Open compounds is disabled' };
    try {
      let health = null;
      if (graphBase) { try { health = await jsonRequest(`${graphBase.replace(/\/+$/, '')}/health`); } catch { /* Similarity remains available while graph artifacts are being qualified. */ } }
      if (source === 'stock') await stockResolver.resolve();
      if (['both', 'real', 'virtual'].includes(source)) await Promise.all((source === 'both' ? ['real','virtual'] : [source]).map((value) => macroResolver.resolve(value)));
      const graphAvailable = health?.available && (source === 'open' || (source === 'both' ? ['real','virtual'] : [source]).every((value) => health.sources.includes(value)));
      return { source, available: true, modes: graphAvailable ? [...OWNED_SEARCH_MODES] : ['similarity'], maxQueries: 20, maxOffset: OWNED_SEARCH_MAX_OFFSET,
        ...(graphAvailable ? {} : { reason: 'Graph/identifier search is not configured for this source' }) };
    } catch (error) { return { source, available: false, modes: [], maxQueries: 20, reason: error.message }; }
  }
  async function openQuery(params, query, cap, deadline) {
    if (!openConfig.enabled || !openConfig.baseUrl) throw new OwnedSearchError('Open compounds is unavailable', 503);
    if (params.mode === 'similarity') {
      const payload = await runOpenCompoundsSearch({ config: openConfig, params: { smiles: query, threshold: params.threshold, maxResults: cap, offset: 0, limit: cap }, fetchImpl: (url, options) => boundedFetch(url, options, deadline) });
      return { results: payload.results, truncated: Boolean(payload.retrieval?.truncatedByRetrievalCap || payload.stats?.truncated || payload.hasMore) };
    }
    const rdkit = await loadRDKit(); let canonical;
    if (params.mode !== 'id') {
      const mol = rdkit.get_mol(query);
      if (!mol) throw new OwnedSearchError('Open structure searches require valid SMILES');
      try { canonical = mol.get_smiles(); } finally { mol.delete(); }
    } else if (!/^CHEMBL\d+$/i.test(query)) throw new OwnedSearchError('Enter a ChEMBL compound ID, such as CHEMBL25');
    const url = new URL(params.mode === 'substructure'
      ? `${openConfig.baseUrl}/substructure/${encodeURIComponent(query)}.json`
      : `${openConfig.baseUrl}/molecule/${encodeURIComponent(params.mode === 'id' ? query.toUpperCase() : query)}.json`);
    url.searchParams.set('limit', String(Math.min(cap, 1000))); url.searchParams.set('offset','0');
    let payload;
    try { payload = await jsonRequest(url.toString(), { deadline }); }
    catch (error) { if (error.status === 404) return { results: [], truncated: false }; throw error; }
    const candidates = (Array.isArray(payload.molecules) ? payload.molecules : [payload]).map(chemblMoleculeToCandidate).filter(Boolean);
    let matches;
    if (params.mode === 'substructure') matches = (await graph('/verify', { query, smiles: candidates.map((row) => row.smiles) }, deadline)).matches;
    const results = candidates.filter((row,index) => {
      if (params.mode === 'substructure') return matches[index];
      if (params.mode === 'id') return row.chemblId === query.toUpperCase();
      const mol = rdkit.get_mol(row.smiles); if (!mol) return false;
      try { return mol.get_smiles() === canonical; } finally { mol.delete(); }
    }).map((row) => ({ ...row, source: 'chembl' })).sort((a,b)=>a.chemblId.localeCompare(b.chemblId));
    return { results, truncated: Number(payload.page_meta?.total_count || candidates.length) > candidates.length };
  }
  async function run(body) {
    const params = parseOwnedSearch(body); const cap = Math.min(params.offset + params.limit + 1, 1000); const deadline = now() + 90000;
    let datasets;
    if (params.source === 'stock') datasets = [await stockResolver.resolve()];
    if (['both','real','virtual'].includes(params.source)) datasets = await Promise.all((params.source === 'both' ? ['real','virtual'] : [params.source]).map((value)=>macroResolver.resolve(value)));
    if (params.mode === 'similarity' && datasets && params.source !== 'stock') for (const dataset of datasets) assertMacrocycleMetricSupported({ ...params, source: dataset.source }, dataset);
    const responses = [];
    for (const query of params.queries) {
      if (now() >= deadline) throw new OwnedSearchError('Batch exceeded 90 seconds; reduce the number of queries', 503);
      try {
        let payload;
        if (params.source === 'open') payload = await openQuery(params, query, cap, deadline);
        else if (params.mode !== 'similarity') {
          payload = await graph('/search', { source: params.source, mode: params.mode, query, cap,
            ...(params.source === 'stock' ? { datasetName: datasets[0].name, datasetId: datasets[0].id } : {}) }, deadline);
        } else {
          const options = { ...params, smiles: query, offset: 0, limit: cap };
          const url = params.source === 'stock' ? buildStockSimilarityUrl({ ...options, baseUrl: stockConfig.baseUrl, datasetId: datasets[0].id })
            : buildMacrocycleSimilarityUrl({ config: macroConfig, datasets, params: options });
          payload = await jsonRequest(url, { deadline });
          payload.truncated = Boolean(payload.hasMore || payload.total > payload.results.length || payload.results.length >= cap);
        }
        if (!Array.isArray(payload.results)) throw new OwnedSearchError('Search returned invalid results', 502);
        if (params.source !== 'open') {
          if (params.source !== 'stock') {
            const tagged = params.source === 'both' ? tagCombinedMacrocycleResults(payload, datasets, params)
              : tagMacrocycleResults(payload, params.source, datasets[0], params);
            payload.results = tagged.results.map((row) => ({ ...row, source: row.source || params.source }));
          } else payload.results = payload.results.map((row) => ({ ...row, source: 'stock' }));
          payload = withCompoundShopOffers(payload, params.source, { secret });
        }
        responses.push(payload);
      } catch (error) {
        // A malformed query is reported on its own batch row. Service failures
        // fail the request rather than presenting incomplete source retrieval.
        if (error.status === 400) responses.push({ results: [], error: error.message });
        else throw error;
      }
    }
    return mergeOwnedSearch(params, responses);
  }
  return { status, run };
}
