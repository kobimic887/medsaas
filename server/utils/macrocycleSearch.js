// The September 23 macrocycle exports are separate search corpora. Neither
// contains pack prices; their hits must never be represented as catalog items.
import {
  buildStockSimilarityUrl,
  parseStockSearchQuery,
  StockSearchValidationError,
} from './stockSearch.js';

export const MACROCYCLE_SOURCES = Object.freeze(['real', 'virtual']);
export const MACROCYCLE_DATASETS = Object.freeze({
  real: {
    name: 'Macrocycles real stock — 2026-09-23',
    sourceFile: 'Pyxis_RealStock_18190.csv',
    sourceUrl: 'https://spectra.pyxis-discovery.com/CompChem/Pyxis_RealStock_18190.csv',
    kind: 'macrocycle_real',
  },
  virtual: {
    name: 'Macrocycles virtual — 2026-09-23',
    sourceFile: 'Pyxis_Virtual_Molecules_20260923.zip',
    sourceUrl: 'https://spectra.pyxis-discovery.com/CompChem/Pyxis_Virtual_Molecules_20260923.zip',
    kind: 'macrocycle_virtual',
  },
});

export class MacrocycleSearchUnavailableError extends Error {
  constructor(message) {
    super(message || 'Macrocycle search is unavailable');
    this.name = 'MacrocycleSearchUnavailableError';
    this.code = 'MACROCYCLE_SEARCH_UNAVAILABLE';
    this.status = 503;
  }
}

export class MacrocycleSearchValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MacrocycleSearchValidationError';
    this.code = 'MACROCYCLE_SEARCH_VALIDATION';
    this.status = 400;
  }
}

export function parseMacrocycleSource(raw) {
  if (typeof raw !== 'string' || !MACROCYCLE_SOURCES.includes(raw.trim())) {
    throw new MacrocycleSearchValidationError('source must be real or virtual');
  }
  return raw.trim();
}

export function parseMacrocycleSearchQuery(query = {}) {
  const source = parseMacrocycleSource(query.source);
  try {
    const parsed = parseStockSearchQuery(query);
    if (parsed.fingerprintType !== 'morgan' || parsed.similarityMetric !== 'tanimoto') {
      throw new MacrocycleSearchValidationError('Macrocycle search supports only Morgan (ECFP4) with binary Tanimoto');
    }
    return { source, ...parsed };
  } catch (error) {
    if (error instanceof StockSearchValidationError) {
      throw new MacrocycleSearchValidationError(error.message);
    }
    throw error;
  }
}

export function macrocycleSearchConfig(env = process.env) {
  const baseUrl = String(env.MACROCYCLE_SEARCH_BASE || '').trim().replace(/\/+$/, '');
  const datasets = {};
  for (const source of MACROCYCLE_SOURCES) {
    const key = source.toUpperCase();
    const rawId = String(env[`MACROCYCLE_${key}_DATASET_ID`] || '').trim();
    const id = rawId ? Number(rawId) : null;
    datasets[source] = {
      id: Number.isInteger(id) && id > 0 ? id : null,
      invalidId: Boolean(rawId) && !(Number.isInteger(id) && id > 0),
      name: String(env[`MACROCYCLE_${key}_DATASET_NAME`] || MACROCYCLE_DATASETS[source].name).trim(),
    };
  }
  return { baseUrl, datasets };
}

export function createMacrocycleDatasetResolver({ config, fetchImpl, now = Date.now, cacheTtlMs = 5 * 60 * 1000 }) {
  const cache = new Map();
  let inflight = null;
  const listing = async () => {
    if (!config.baseUrl) throw new MacrocycleSearchUnavailableError('MACROCYCLE_SEARCH_BASE is not configured');
    const cached = cache.get('listing');
    if (cached && now() - cached.at < cacheTtlMs) return cached.datasets;
    if (inflight) return inflight;
    inflight = (async () => {
      let response;
      try { response = await fetchImpl(`${config.baseUrl}/v1/datasets`); }
      catch { throw new MacrocycleSearchUnavailableError('Macrocycle search service is unreachable'); }
      if (!response?.ok) {
        throw new MacrocycleSearchUnavailableError(`Macrocycle search service returned HTTP ${response?.status ?? 'error'}`);
      }
      let payload;
      try { payload = await response.json(); }
      catch { throw new MacrocycleSearchUnavailableError('Macrocycle search service returned invalid dataset data'); }
      if (!Array.isArray(payload?.datasets)) {
        throw new MacrocycleSearchUnavailableError('Macrocycle search service returned invalid dataset data');
      }
      cache.set('listing', { at: now(), datasets: payload.datasets });
      return payload.datasets;
    })().finally(() => { inflight = null; });
    return inflight;
  };
  return {
    async resolve(source) {
      const selected = parseMacrocycleSource(source);
      if (!config.baseUrl) throw new MacrocycleSearchUnavailableError('MACROCYCLE_SEARCH_BASE is not configured');
      const entry = config.datasets[selected];
      if (entry.invalidId) throw new MacrocycleSearchUnavailableError(`MACROCYCLE_${selected.toUpperCase()}_DATASET_ID is invalid`);
      // Even pinned IDs are listed, so stale/replaced datasets cannot silently
      // be searched or confused with the older stock corpus.
      const datasets = await listing();
      const match = datasets.find((item) => item && item.name === entry.name
        && (entry.id === null || Number(item.id) === entry.id));
      if (!match || !Number.isInteger(Number(match.id)) || Number(match.id) <= 0) {
        throw new MacrocycleSearchUnavailableError(`Macrocycle ${selected} dataset "${entry.name}" is not provisioned`);
      }
      return {
        id: Number(match.id), name: entry.name,
        rowCount: Number.isFinite(Number(match.row_count)) ? Number(match.row_count) : null,
        source: selected,
      };
    },
    reset() { cache.clear(); },
  };
}

export function buildMacrocycleSimilarityUrl({ config, dataset, params }) {
  if (!config.baseUrl) throw new MacrocycleSearchUnavailableError('MACROCYCLE_SEARCH_BASE is not configured');
  return buildStockSimilarityUrl({
    baseUrl: config.baseUrl, datasetId: dataset.id,
    smiles: params.smiles, threshold: params.threshold, offset: params.offset,
    limit: params.limit, fingerprintType: params.fingerprintType,
    similarityMetric: params.similarityMetric,
  });
}

export function macrocycleStatusPayload(source, dataset) {
  return {
    available: true, source,
    dataset: { id: dataset.id, name: dataset.name, rowCount: dataset.rowCount },
    fingerprintType: 'morgan', similarityMetric: 'tanimoto',
    capabilities: {
      fingerprintTypes: [{ value: 'morgan', label: 'Morgan (ECFP4)' }],
      similarityMetrics: [{ value: 'tanimoto', label: 'Tanimoto (binary)' }],
    },
  };
}

export function tagMacrocycleResults(data, source, dataset, params) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    throw new MacrocycleSearchUnavailableError('Macrocycle search service returned invalid results');
  }
  const kind = MACROCYCLE_DATASETS[source].kind;
  const allowedMetadata = new Set([
    'ID', 'MAIN_BAS', 'compound_id', 'source_file', 'web_mg', 'web_uM',
    'CURRENT_TOT_NETTO_MG', 'CURRENT_TOT_AMOUNT_UM', 'Lead_TIME',
  ]);
  return {
    ...data, source,
    dataset: { id: dataset.id, name: dataset.name, rowCount: dataset.rowCount },
    method: { fingerprint_type: params.fingerprintType, similarity_metric: params.similarityMetric, threshold: params.threshold },
    results: data.results.map((hit) => {
      const raw = hit.metadata && typeof hit.metadata === 'object' ? hit.metadata : {};
      const metadata = Object.fromEntries(Object.entries(raw).filter(([key]) => allowedMetadata.has(key)));
      metadata.ID ||= metadata.MAIN_BAS;
      metadata.compound_id ||= metadata.MAIN_BAS;
      metadata.source = kind;
      metadata.dataset_name = dataset.name;
      return {
        molecule_id: hit.molecule_id,
        canonical_smiles: hit.canonical_smiles,
        similarity: hit.similarity,
        metadata,
      };
    }).sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)
      || Number(a.molecule_id) - Number(b.molecule_id)),
  };
}
