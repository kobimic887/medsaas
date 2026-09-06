// Stock-compound search backend: resolution + request contract for the
// Simulation molecule search (docs/DATA-STOCK-COMPOUNDS.md).
//
// Anna's MOE export (630,652 rows) is imported into a tonomitosql search
// service as a DATASET. The engine computes all six RDKit search fingerprints
// from SMILES for library AND query molecules — MOE FP:* columns stay archived
// in the source TSV, they are never compared against RDKit query fingerprints.
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

  return {
    smiles: rawSmiles,
    threshold,
    offset,
    limit: Math.min(limit, STOCK_SIMILARITY_MAX_LIMIT),
  };
}

/** Build the upstream similarity-search URL for one page of ranked results. */
export function buildStockSimilarityUrl({ baseUrl, datasetId, smiles, threshold, offset, limit }) {
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
    // Morgan/ECFP4 + Tanimoto are the engine defaults and match the declared,
    // consistent RDKit fingerprint method for both library and query.
    fingerprint_type: 'morgan',
    similarity_metric: 'tanimoto',
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
  const text = typeof body === 'string' ? body.slice(0, 200) : '';
  if (typeof body === 'object' && body !== null) {
    const detail = body.detail ?? body.error ?? body.message;
    if (typeof detail === 'string' && detail.trim()) return detail.trim().slice(0, 300);
  }
  if (status === 400) return text || 'The stock search rejected the query';
  if (status === 502) return 'Stock search is temporarily unavailable';
  return text || `Stock search failed (HTTP ${status})`;
}
