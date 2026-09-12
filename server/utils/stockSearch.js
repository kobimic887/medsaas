// Stock-compound search backend: resolution + request contract for the
// Simulation molecule search (docs/DATA-STOCK-COMPOUNDS.md).
//
// Anna's MOE export (630,652 rows) is imported into a tonomitosql search
// service as a DATASET. The engine computes all six RDKit search fingerprints
// from SMILES for library AND query molecules — MOE FP:* columns stay archived
// in the source TSV, they are never compared against RDKit query fingerprints.
//
// The client selects fingerprint + similarity metric per search from the
// verified allowlist below (STOCK_FINGERPRINT_TYPES / STOCK_SIMILARITY_METRICS,
// measured live against the stock dataset 2026-09-12). Every option is a
// BINARY RDKit bit-vector fingerprint computed engine-side and both metrics
// are binary formulas — there is NO count-vector option and none may be
// exposed (MOE's count-based btanimoto/ctanimoto numbers are not reproducible
// from the archived columns and were never a target).
//
// Config contract (server env — never hardcoded, never per-company):
//   STOCK_SEARCH_BASE        tonomitosql base URL holding the stock dataset.
//                            Unset → the shared TANIMOTO_API_BASE service, so a
//                            live import into the production search service
//                            works with no extra env. Dev/verification point
//                            this at an isolated stack (e.g. scratch :8010).
//   STOCK_SEARCH_DATASET_ID  Pin the dataset by numeric id. If unset the
//                            dataset is discovered by name (below). Never
//                            hardcode a specific dataset id in application code.
//   STOCK_SEARCH_DATASET_NAME Dataset name to discover when the id is unset.
//                            Default matches the importer's default name.
//
// When no matching dataset is provisioned the feature is UNAVAILABLE
// (StockSearchUnavailableError → HTTP 503) — the caller must surface that as a
// distinct state and never silently fall back to the ASINEX corpus.
//
// Search contract (tonomitosql, measured against the isolated scratch stack
// 2026-09-06): ranked similarity paginates by OFFSET/LIMIT over a stable KNN
// ordering — same-query pages do not repeat or skip rows. There is no fromId
// and no total count; the page tells you when it ends by returning fewer than
// `limit` rows.

export const DEFAULT_STOCK_DATASET_NAME = 'Stock compounds — 2026-09-01';
export const STOCK_SIMILARITY_MIN_THRESHOLD = 0.1;
export const STOCK_SIMILARITY_MAX_THRESHOLD = 1.0;
export const STOCK_SIMILARITY_MAX_LIMIT = 100;
export const STOCK_DATASET_CACHE_TTL_MS = 5 * 60 * 1000;

// Verified engine allowlist (tonomitosql FP_CONFIG / SIM_CONFIG; all values
// confirmed against the stock dataset 2026-09-12). All six fingerprints are
// BINARY RDKit bit vectors computed engine-side from SMILES (the morganbv_fp
// family); tanimoto and dice are the two binary similarity formulas. Absent
// params fall back to morgan + tanimoto — the engine defaults — so old callers
// keep byte-identical wire behavior.
export const STOCK_FINGERPRINT_TYPES = Object.freeze([
  'morgan',
  'maccs',
  'feat_morgan',
  'atom_pair',
  'torsion',
  'rdkit',
]);
export const STOCK_SIMILARITY_METRICS = Object.freeze(['tanimoto', 'dice']);
export const DEFAULT_STOCK_FINGERPRINT_TYPE = 'morgan';
export const DEFAULT_STOCK_SIMILARITY_METRIC = 'tanimoto';

// "(binary)" is deliberate: a binary score must never read as count-based.
export const STOCK_FINGERPRINT_LABELS = {
  morgan: 'Morgan (ECFP4)',
  maccs: 'MACCS keys (166-bit)',
  feat_morgan: 'Feature Morgan (FCFP4)',
  atom_pair: 'Atom pair',
  torsion: 'Topological torsion',
  rdkit: 'RDKit path',
};
export const STOCK_SIMILARITY_METRIC_LABELS = {
  tanimoto: 'Tanimoto (binary)',
  dice: 'Dice (binary)',
};

/** Selector options the client may offer for stock similarity searches. */
export function stockSearchCapabilities() {
  return {
    fingerprintTypes: STOCK_FINGERPRINT_TYPES.map((value) => ({
      value,
      label: STOCK_FINGERPRINT_LABELS[value],
    })),
    similarityMetrics: STOCK_SIMILARITY_METRICS.map((value) => ({
      value,
      label: STOCK_SIMILARITY_METRIC_LABELS[value],
    })),
  };
}

export class StockSearchUnavailableError extends Error {
  constructor(reason) {
    super(reason || 'Stock-compound search is not available');
    this.name = 'StockSearchUnavailableError';
    this.code = 'STOCK_SEARCH_UNAVAILABLE';
    this.status = 503;
  }
}

export class StockSearchValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StockSearchValidationError';
    this.code = 'STOCK_SEARCH_VALIDATION';
    this.status = 400;
  }
}

/** Read the stock-search configuration from env. Pure; no side effects. */
export function stockSearchConfig(env = process.env) {
  const baseUrl = String(
    env.STOCK_SEARCH_BASE || env.TANIMOTO_API_BASE || ''
  ).trim().replace(/\/+$/, '');
  const datasetIdRaw = String(env.STOCK_SEARCH_DATASET_ID || '').trim();
  const datasetName = String(
    env.STOCK_SEARCH_DATASET_NAME || DEFAULT_STOCK_DATASET_NAME
  ).trim();

  let datasetId = null;
  let datasetIdInvalid = false;
  if (datasetIdRaw) {
    const parsed = Number(datasetIdRaw);
    if (Number.isInteger(parsed) && parsed > 0) datasetId = parsed;
    else datasetIdInvalid = true;
  }

  return { baseUrl, datasetId, datasetIdInvalid, datasetName };
}

/**
 * Create a dataset resolver with a bounded in-memory cache.
 * `deps.fetchImpl(url)` must return a Response-like object (ok/status/json()).
 */
export function createStockDatasetResolver({
  config,
  fetchImpl,
  cacheTtlMs = STOCK_DATASET_CACHE_TTL_MS,
  now = Date.now,
}) {
  if (!config || typeof config !== 'object') {
    throw new Error('createStockDatasetResolver requires a config object');
  }
  let cache = null; // { id, name, rowCount, resolvedAt }
  let inflight = null;

  const resolve = async () => {
    if (config.datasetIdInvalid) {
      throw new StockSearchUnavailableError(
        `STOCK_SEARCH_DATASET_ID is not a positive integer: ${process.env.STOCK_SEARCH_DATASET_ID}`
      );
    }
    // Pinned id: no listing round-trip needed.
    if (config.datasetId !== null) {
      return {
        id: config.datasetId,
        name: config.datasetName || DEFAULT_STOCK_DATASET_NAME,
        rowCount: null,
        pinned: true,
      };
    }
    if (!config.baseUrl) {
      throw new StockSearchUnavailableError(
        'No stock-compound search service is configured (STOCK_SEARCH_BASE/TANIMOTO_API_BASE)'
      );
    }
    const cached = cache && now() - cache.resolvedAt < cacheTtlMs ? cache : null;
    if (cached) return cached;
    if (inflight) return inflight;

    inflight = (async () => {
      let response;
      try {
        response = await fetchImpl(`${config.baseUrl}/v1/datasets`);
      } catch (error) {
        throw new StockSearchUnavailableError(
          `Stock search service unreachable (${config.baseUrl}): ${error?.message || error}`
        );
      }
      if (!response || !response.ok) {
        throw new StockSearchUnavailableError(
          `Stock search service returned HTTP ${response?.status ?? 'error'} (${config.baseUrl})`
        );
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const datasets = Array.isArray(payload?.datasets) ? payload.datasets : [];
      const match = datasets.find(
        (dataset) => dataset && String(dataset.name ?? '').trim() === config.datasetName
      );
      if (!match || !Number.isInteger(Number(match.id))) {
        throw new StockSearchUnavailableError(
          `No stock dataset named "${config.datasetName}" is provisioned in the search service`
        );
      }
      const resolved = {
        id: Number(match.id),
        name: config.datasetName,
        rowCount: Number.isFinite(Number(match.row_count)) ? Number(match.row_count) : null,
        resolvedAt: now(),
      };
      cache = resolved;
      return resolved;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  return {
    resolve,
    reset: () => {
      cache = null;
    },
  };
}

/**
 * Validate one allowlisted selector (fingerprint_type / similarity_metric).
 * Absent or blank → default; a value outside the allowlist → 400 with the
 * supported values listed so the client can correct the request.
 */
function parseStockSearchChoice(raw, allowed, fallback, field) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return fallback;
  if (allowed.includes(value)) return value;
  throw new StockSearchValidationError(
    `Unsupported ${field}: "${value.slice(0, 60)}". Supported values: ${allowed.join(', ')}`
  );
}

/**
 * Validate a similarity-search query object (from req.query) and return
 * normalized parameters. Throws StockSearchValidationError (HTTP 400) on
 * bad input. Values mirror the tonomitosql /v1/search/similarity endpoint.
 */
export function parseStockSearchQuery(query = {}) {
  const rawSmiles = typeof query.smiles === 'string' ? query.smiles.trim() : '';
  if (!rawSmiles) throw new StockSearchValidationError('smiles is required');
  if (rawSmiles.length > 2000) {
    throw new StockSearchValidationError('smiles is too long (max 2000 characters)');
  }

  const threshold = query.threshold === undefined || query.threshold === ''
    ? 0.5
    : Number(query.threshold);
  if (!Number.isFinite(threshold)
      || threshold < STOCK_SIMILARITY_MIN_THRESHOLD
      || threshold > STOCK_SIMILARITY_MAX_THRESHOLD) {
    throw new StockSearchValidationError(
      `threshold must be between ${STOCK_SIMILARITY_MIN_THRESHOLD} and ${STOCK_SIMILARITY_MAX_THRESHOLD}`
    );
  }

  const offset = query.offset === undefined || query.offset === ''
    ? 0
    : Number(query.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new StockSearchValidationError('offset must be a non-negative integer');
  }

  const limit = query.limit === undefined || query.limit === ''
    ? 50
    : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new StockSearchValidationError('limit must be a positive integer');
  }

  const fingerprintType = parseStockSearchChoice(
    query.fingerprint_type,
    STOCK_FINGERPRINT_TYPES,
    DEFAULT_STOCK_FINGERPRINT_TYPE,
    'fingerprint_type',
  );
  const similarityMetric = parseStockSearchChoice(
    query.similarity_metric,
    STOCK_SIMILARITY_METRICS,
    DEFAULT_STOCK_SIMILARITY_METRIC,
    'similarity_metric',
  );

  return {
    smiles: rawSmiles,
    threshold,
    offset,
    limit: Math.min(limit, STOCK_SIMILARITY_MAX_LIMIT),
    fingerprintType,
    similarityMetric,
  };
}

/**
 * Build the upstream similarity-search URL for one page of ranked results.
 * fingerprint_type + similarity_metric are ALWAYS appended: the engine
 * defaults are identical, so wiring behavior is unchanged for callers that
 * omit them, but the searched method is pinned in the URL instead of assumed.
 */
export function buildStockSimilarityUrl({
  baseUrl,
  datasetId,
  smiles,
  threshold,
  offset,
  limit,
  fingerprintType = DEFAULT_STOCK_FINGERPRINT_TYPE,
  similarityMetric = DEFAULT_STOCK_SIMILARITY_METRIC,
}) {
  if (!baseUrl) throw new StockSearchUnavailableError('No stock-compound search service is configured');
  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    throw new StockSearchUnavailableError('The stock dataset is not provisioned');
  }
  const params = new URLSearchParams({
    smiles,
    threshold: String(threshold),
    offset: String(offset),
    limit: String(limit),
    dataset_id: String(datasetId),
    fingerprint_type: fingerprintType,
    similarity_metric: similarityMetric,
  });
  return `${baseUrl}/v1/search/similarity?${params.toString()}`;
}

/**
 * Map an upstream HTTP status for relay to the browser. The route already ran
 * authenticateToken, so an upstream 401/403 means the SERVER's access to the
 * internal search service failed — surface 502, never 401 (the client treats a
 * same-origin 401 as a dead session). Validation stays 400.
 */
export function relayStockUpstreamStatus(status) {
  if (status === 401 || status === 403) return 502;
  // The app has its own rate limiters; a relayed 429 would be indistinguishable
  // from one of them firing, so it becomes 503 like the other proxies.
  if (status === 429) return 503;
  if (status >= 500) return 502;
  return status;
}

/** Human-readable client error for a failed upstream stock search. */
export function describeStockUpstreamError(status, body) {
  // A generic cartridge parse failure also covers sanitization/valence failures.
  // Explain what to check without claiming an atom-level diagnosis or repairing it.
  const detailText = typeof body === 'string' ? body : body?.detail ?? body?.error ?? body?.message;
  if (status === 400 && typeof detailText === 'string'
      && /invalid smiles|smiles.*invalid|could not be parsed by rdkit/i.test(detailText)) {
    return 'This structure cannot be searched. Check atom charges and bond orders. A structure may display in the editor but still fail chemical validation. Your input has been kept so you can edit it.';
  }
  const text = typeof body === 'string' ? body.slice(0, 200) : '';
  if (typeof body === 'object' && body !== null) {
    const detail = body.detail ?? body.error ?? body.message;
    if (typeof detail === 'string' && detail.trim()) return detail.trim().slice(0, 300);
  }
  if (status === 400) return text || 'The stock search rejected the query';
  if (status === 502) return 'Stock search is temporarily unavailable';
  return text || `Stock search failed (HTTP ${status})`;
}
