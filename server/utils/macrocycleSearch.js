// The September 23 macrocycle exports are separate search corpora. Neither
// contains pack prices; their hits must never be represented as catalog items.
//
// Similarity methods: the stored RDKit Morgan (ECFP4) BINARY Tanimoto, plus two
// frequency-weighted COUNT metrics computed over the same Morgan environments
// (server/utils/countMorgan.js). The count metrics are advertised only when the
// loopback index has a packed count stream (format 2); a format-1 index keeps
// working and offers Tanimoto alone. Count values are a Pyxis method — they are
// NOT MOE ctanimoto and are never labelled as MOE or MOE-comparable
// (docs/REFERENCE-STOCK-FP-METRICS.md). The app-side allowlist here must stay in
// step with SIMILARITY_METRICS in services/macrocycle-index/common.mjs;
// services/macrocycle-index/test.mjs asserts the two agree.
import {
  buildStockSimilarityUrl,
  parseStockSearchQuery,
  StockSearchValidationError,
} from './stockSearch.js';

export const MACROCYCLE_FINGERPRINT_TYPES = Object.freeze(['morgan']);
export const MACROCYCLE_FINGERPRINT_LABELS = Object.freeze({ morgan: 'Morgan (ECFP4)' });
export const MACROCYCLE_SIMILARITY_METRICS = Object.freeze(['tanimoto', 'count_tanimoto', 'count_dice']);
export const MACROCYCLE_DEFAULT_SIMILARITY_METRIC = 'tanimoto';

// "(binary)" / "(frequency-weighted)" is deliberate: a count score must never
// read as binary, and a binary score must never read as count-based.
export const MACROCYCLE_SIMILARITY_METRIC_LABELS = Object.freeze({
  tanimoto: 'Tanimoto (binary)',
  count_tanimoto: 'Count Tanimoto (frequency-weighted)',
  count_dice: 'Count Dice (frequency-weighted)',
});

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

// Import/build operations accept only the two physical datasets. The search
// API additionally accepts their combined ranked view.
export function parseMacrocycleSearchSource(raw) {
  if (typeof raw === 'string' && raw.trim() === 'both') return 'both';
  try { return parseMacrocycleSource(raw); }
  catch { throw new MacrocycleSearchValidationError('source must be both, real or virtual'); }
}

export function parseMacrocycleSearchQuery(query = {}) {
  const source = parseMacrocycleSearchSource(query.source);
  const fingerprintType = typeof query.fingerprint_type === 'string' ? query.fingerprint_type.trim() : '';
  if (fingerprintType && fingerprintType !== 'morgan') {
    throw new MacrocycleSearchValidationError(
      `Unsupported fingerprint_type: "${fingerprintType.slice(0, 60)}". Supported values: ${MACROCYCLE_FINGERPRINT_TYPES.join(', ')}`
    );
  }
  const rawMetric = typeof query.similarity_metric === 'string' ? query.similarity_metric.trim() : '';
  const similarityMetric = rawMetric || MACROCYCLE_DEFAULT_SIMILARITY_METRIC;
  if (!MACROCYCLE_SIMILARITY_METRICS.includes(similarityMetric)) {
    throw new MacrocycleSearchValidationError(
      `Unsupported similarity_metric: "${similarityMetric.slice(0, 60)}". Supported values: ${MACROCYCLE_SIMILARITY_METRICS.join(', ')}`
    );
  }
  try {
    // Reuse the stock query parser for smiles/threshold/offset/limit, with the
    // method pinned so its own (binary-only) allowlist cannot reject a count
    // metric before this contract validates it.
    const parsed = parseStockSearchQuery({
      ...query,
      fingerprint_type: 'morgan',
      similarity_metric: MACROCYCLE_DEFAULT_SIMILARITY_METRIC,
    });
    return { source, ...parsed, similarityMetric };
  } catch (error) {
    if (error instanceof StockSearchValidationError) {
      throw new MacrocycleSearchValidationError(error.message);
    }
    throw error;
  }
}

/**
 * Guard a resolved dataset against the requested metric. The count metrics need
 * the format-2 count stream, so a binary-only index must answer 400 (a client
 * error) here instead of letting the loopback service relay it as an outage.
 */
export function assertMacrocycleMetricSupported(params, dataset) {
  const metrics = Array.isArray(dataset?.metrics) ? dataset.metrics : [];
  if (metrics.length > 0 && !metrics.includes(params.similarityMetric)) {
    throw new MacrocycleSearchValidationError(
      `The ${params.source} macrocycle dataset provides ${metrics.join(', ')} only. `
        + 'Rebuild its index with count fingerprints to enable the count metrics.'
    );
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
      // A format-1 index lists no metrics; it is binary Tanimoto only.
      const advertised = Array.isArray(match.metrics) ? match.metrics : [];
      const metrics = advertised.filter((metric) => MACROCYCLE_SIMILARITY_METRICS.includes(metric));
      return {
        id: Number(match.id), name: entry.name,
        rowCount: Number.isFinite(Number(match.row_count)) ? Number(match.row_count) : null,
        source: selected,
        metrics: metrics.length > 0 ? metrics : [MACROCYCLE_DEFAULT_SIMILARITY_METRIC],
      };
    },
    reset() { cache.clear(); },
  };
}

export function buildMacrocycleSimilarityUrl({ config, dataset, datasets, params }) {
  if (!config.baseUrl) throw new MacrocycleSearchUnavailableError('MACROCYCLE_SEARCH_BASE is not configured');
  const selected = datasets || [dataset];
  const url = new URL(buildStockSimilarityUrl({
    baseUrl: config.baseUrl, datasetId: selected[0].id,
    smiles: params.smiles, threshold: params.threshold, offset: params.offset,
    limit: params.limit, fingerprintType: params.fingerprintType,
    similarityMetric: params.similarityMetric,
  }));
  if (selected.length === 2) {
    url.searchParams.delete('dataset_id');
    url.searchParams.set('dataset_ids', selected.map(({ id }) => id).join(','));
  }
  return url.toString();
}

export function macrocycleStatusPayload(source, dataset) {
  const advertised = Array.isArray(dataset?.metrics) ? dataset.metrics : [];
  const metrics = advertised.filter((metric) => MACROCYCLE_SIMILARITY_METRICS.includes(metric));
  const available = metrics.length > 0 ? metrics : [MACROCYCLE_DEFAULT_SIMILARITY_METRIC];
  return {
    available: true, source,
    dataset: { id: dataset.id, name: dataset.name, rowCount: dataset.rowCount },
    fingerprintType: MACROCYCLE_FINGERPRINT_TYPES[0],
    similarityMetric: MACROCYCLE_DEFAULT_SIMILARITY_METRIC,
    countMetricsAvailable: metrics.some((metric) => metric !== MACROCYCLE_DEFAULT_SIMILARITY_METRIC),
    capabilities: {
      fingerprintTypes: MACROCYCLE_FINGERPRINT_TYPES.map((value) => ({
        value, label: MACROCYCLE_FINGERPRINT_LABELS[value],
      })),
      similarityMetrics: available.map((value) => ({
        value, label: MACROCYCLE_SIMILARITY_METRIC_LABELS[value],
      })),
    },
  };
}

export function combinedMacrocycleStatusPayload(datasets) {
  const metrics = MACROCYCLE_SIMILARITY_METRICS.filter((metric) =>
    datasets.every((dataset) => dataset.metrics.includes(metric)));
  const count = datasets.reduce((sum, dataset) => sum + (dataset.rowCount || 0), 0);
  return macrocycleStatusPayload('both', {
    id: null, name: 'Real and virtual macrocycles', rowCount: count, metrics,
  });
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

export function tagCombinedMacrocycleResults(data, datasets, params) {
  if (!data || !Array.isArray(data.results)) {
    throw new MacrocycleSearchUnavailableError('Macrocycle search service returned invalid results');
  }
  const bySource = Object.fromEntries(datasets.map((dataset) => [dataset.source, dataset]));
  const results = data.results.map((hit) => {
    const dataset = bySource[hit.source];
    if (!dataset) throw new MacrocycleSearchUnavailableError('Combined search returned an unknown source');
    return { ...tagMacrocycleResults({ results: [hit] }, hit.source, dataset, params).results[0], source: hit.source };
  });
  return {
    ...data, source: 'both',
    datasets: datasets.map(({ id, name, rowCount, source }) => ({ id, name, rowCount, source })),
    method: { fingerprint_type: params.fingerprintType, similarity_metric: params.similarityMetric, threshold: params.threshold },
    results,
  };
}
