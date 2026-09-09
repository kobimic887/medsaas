// Open-compounds search: ChEMBL candidate retrieval + local RDKit Morgan re-score.
//
// Declared final score (query and candidates, identical settings):
//   RDKit Morgan bit vector, radius=2, nBits=2048,
//   useChirality=false, useBondTypes=true, useFeatures=false,
//   Tanimoto similarity.
// Structure policy: parse with RDKit get_mol as written. Invalid structures are
// dropped (never silently charge-/bond-repaired). Dedup identity = InChIKey when
// ChEMBL provides one, else RDKit canonical SMILES.
//
// Upstream retrieval uses the ChEMBL Data Web Services similarity endpoint
// (https://www.ebi.ac.uk/chembl/api/data/similarity/{smiles}/{pct}). That
// endpoint's own Tanimoto ranks candidates; measured 2026-09-09 against the
// reference query, those percentages matched this Morgan setting bit-for-bit.
// Regardless, every displayed score is recomputed locally. Results are ranked
// among retrieved candidates — not guaranteed exhaustive database-wide top-N.
//
// Attribution: ChEMBL data are © EMBL-EBI / ChEMBL contributors; reuse under
// the ChEMBL licence (CC Attribution). Link each hit to its ChEMBL compound page.
//
// AI orchestration lives in openCompoundsAi.js (tool loop). Similarity numbers
// never come from a model — only from this RDKit path.

import initRDKitModule from '@rdkit/rdkit';

export const OPEN_COMPOUNDS_SOURCE = 'chembl';
export const OPEN_COMPOUNDS_SOURCE_LABEL = 'ChEMBL';
export const OPEN_COMPOUNDS_ATTRIBUTION =
  'Compound records from ChEMBL (EMBL-EBI). Licensed for attribution; see https://chembl.gitbook.io/chembl-interface-documentation/about';
export const OPEN_COMPOUNDS_BASE_DEFAULT = 'https://www.ebi.ac.uk/chembl/api/data';
export const OPEN_COMPOUNDS_COMPOUND_URL = 'https://www.ebi.ac.uk/chembl/compound_report_card';

/** Final fingerprint declaration — exported in API responses and CSV/SDF. */
export const OPEN_COMPOUNDS_FINGERPRINT = Object.freeze({
  type: 'morgan',
  radius: 2,
  nBits: 2048,
  useChirality: false,
  useBondTypes: true,
  useFeatures: false,
  similarityMetric: 'tanimoto',
  standardization: 'rdkit_get_mol_as_written_no_repair',
  identityPolicy: 'inchikey_else_canonical_smiles',
});

export const OPEN_SIMILARITY_MIN_THRESHOLD = 0.4; // ChEMBL path floor is 40%
export const OPEN_SIMILARITY_MAX_THRESHOLD = 1.0;
export const OPEN_SIMILARITY_MAX_RESULTS = 100; // owner-bounded requested count
export const OPEN_SIMILARITY_MAX_PAGE = 50;
export const OPEN_CHEMBL_RETRIEVAL_PAGE = 100; // ChEMBL page size while collecting
export const OPEN_CHEMBL_RETRIEVAL_CAP = 300; // max upstream molecules considered
export const OPEN_CHEMBL_TIMEOUT_MS = 45000;

export class OpenCompoundsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OpenCompoundsValidationError';
    this.code = 'OPEN_COMPOUNDS_VALIDATION';
    this.status = 400;
  }
}

export class OpenCompoundsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OpenCompoundsUnavailableError';
    this.code = 'OPEN_COMPOUNDS_UNAVAILABLE';
    this.status = 503;
  }
}

export class OpenCompoundsUpstreamError extends Error {
  constructor(message, { status = 502, partial = false } = {}) {
    super(message);
    this.name = 'OpenCompoundsUpstreamError';
    this.code = partial ? 'OPEN_COMPOUNDS_PARTIAL' : 'OPEN_COMPOUNDS_UPSTREAM';
    this.status = status;
    this.partial = partial;
  }
}

/** Read open-compounds config from env. Pure; no side effects. */
export function openCompoundsConfig(env = process.env) {
  const baseUrl = String(env.OPEN_COMPOUNDS_BASE || OPEN_COMPOUNDS_BASE_DEFAULT)
    .trim()
    .replace(/\/+$/, '');
  const enabledRaw = String(env.OPEN_COMPOUNDS_ENABLED ?? 'true').trim().toLowerCase();
  const enabled = !(enabledRaw === '0' || enabledRaw === 'false' || enabledRaw === 'off');
  const aiConfigured = String(env.OPEN_COMPOUNDS_AI_ENABLED || '').trim().toLowerCase() === 'true';
  const aiProvider = String(env.OPEN_COMPOUNDS_AI_PROVIDER || '').trim().toLowerCase() || null;
  const aiModel = String(env.OPEN_COMPOUNDS_AI_MODEL || '').trim() || null;
  const hasAiKey = Boolean(
    String(env.OPEN_COMPOUNDS_AI_API_KEY || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || '').trim()
  );
  // Detailed enablement (allowlist, free/paid gate) is resolved in openCompoundsAi.js
  // at request time so this file stays free of a circular import.
  return {
    baseUrl,
    enabled,
    ai: {
      configured: aiConfigured,
      hasKey: hasAiKey,
      provider: aiProvider,
      model: aiModel,
    },
  };
}

export function parseOpenCompoundsQuery(query = {}) {
  const rawSmiles = typeof query.smiles === 'string' ? query.smiles.trim() : '';
  if (!rawSmiles) throw new OpenCompoundsValidationError('smiles is required');
  if (rawSmiles.length > 2000) {
    throw new OpenCompoundsValidationError('smiles is too long (max 2000 characters)');
  }

  const threshold = query.threshold === undefined || query.threshold === ''
    ? 0.7
    : Number(query.threshold);
  if (!Number.isFinite(threshold)
      || threshold < OPEN_SIMILARITY_MIN_THRESHOLD
      || threshold > OPEN_SIMILARITY_MAX_THRESHOLD) {
    throw new OpenCompoundsValidationError(
      `threshold must be between ${OPEN_SIMILARITY_MIN_THRESHOLD} and ${OPEN_SIMILARITY_MAX_THRESHOLD} (ChEMBL retrieval floor is 40%)`
    );
  }

  const offset = query.offset === undefined || query.offset === ''
    ? 0
    : Number(query.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new OpenCompoundsValidationError('offset must be a non-negative integer');
  }

  const limit = query.limit === undefined || query.limit === ''
    ? 20
    : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new OpenCompoundsValidationError('limit must be a positive integer');
  }

  const maxResults = query.maxResults === undefined || query.maxResults === ''
    ? OPEN_SIMILARITY_MAX_RESULTS
    : Number(query.maxResults);
  if (!Number.isInteger(maxResults) || maxResults < 1) {
    throw new OpenCompoundsValidationError('maxResults must be a positive integer');
  }

  return {
    smiles: rawSmiles,
    threshold,
    offset,
    limit: Math.min(limit, OPEN_SIMILARITY_MAX_PAGE),
    maxResults: Math.min(maxResults, OPEN_SIMILARITY_MAX_RESULTS),
  };
}

export function relayOpenUpstreamStatus(status) {
  if (status === 401 || status === 403) return 502;
  if (status === 429) return 503;
  if (status >= 500) return 502;
  return status;
}

export function chemblCompoundUrl(chemblId) {
  return `${OPEN_COMPOUNDS_COMPOUND_URL}/${encodeURIComponent(chemblId)}/`;
}

export function buildChemblSimilarityUrl({ baseUrl, smiles, thresholdPercent, offset, limit }) {
  const encoded = encodeURIComponent(smiles);
  const pct = Math.max(40, Math.min(100, Math.round(thresholdPercent)));
  const params = new URLSearchParams({
    format: 'json',
    limit: String(limit),
    offset: String(offset),
  });
  return `${baseUrl}/similarity/${encoded}/${pct}?${params.toString()}`;
}

let rdkitModulePromise = null;

/** Lazy singleton for @rdkit/rdkit (WASM). */
export function loadRDKit(initImpl = initRDKitModule) {
  if (!rdkitModulePromise) {
    rdkitModulePromise = Promise.resolve(initImpl()).then((mod) => mod);
  }
  return rdkitModulePromise;
}

/** Test helper — reset the singleton between suites. */
export function resetRDKitForTests() {
  rdkitModulePromise = null;
}

export function morganDetailsJson(fp = OPEN_COMPOUNDS_FINGERPRINT) {
  return JSON.stringify({
    radius: fp.radius,
    nBits: fp.nBits,
    useChirality: fp.useChirality,
    useBondTypes: fp.useBondTypes,
    useFeatures: fp.useFeatures,
  });
}

function popcountAndOr(a, b) {
  let andBits = 0;
  let orBits = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] & b[i];
    const y = a[i] | b[i];
    // 8-bit popcount
    let xx = x;
    let yy = y;
    for (let bit = 0; bit < 8; bit++) {
      if (xx & 1) andBits++;
      if (yy & 1) orBits++;
      xx >>= 1;
      yy >>= 1;
    }
  }
  return { andBits, orBits };
}

/**
 * Validate a SMILES and return { smiles, fpUint8, molblock } or null.
 * Does not repair charges/bonds; get_mol failure → null.
 */
export function validateAndFingerprint(RDKit, smiles, detailsJson = morganDetailsJson()) {
  if (typeof smiles !== 'string' || !smiles.trim()) return null;
  const mol = RDKit.get_mol(smiles.trim());
  if (!mol) return null;
  try {
    const canonical = mol.get_smiles();
    if (!canonical) return null;
    const fp = mol.get_morgan_fp_as_uint8array(detailsJson);
    if (!fp || fp.length === 0) return null;
    const molblock = mol.get_molblock();
    return {
      smiles: canonical,
      fpUint8: Uint8Array.from(fp),
      molblock: typeof molblock === 'string' ? molblock : null,
    };
  } finally {
    mol.delete();
  }
}

export function tanimotoUint8(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return null;
  const { andBits, orBits } = popcountAndOr(a, b);
  if (orBits === 0) return 0;
  return andBits / orBits;
}

/** Normalize one ChEMBL molecule record into a candidate shell (pre-score). */
export function chemblMoleculeToCandidate(molecule) {
  if (!molecule || typeof molecule !== 'object') return null;
  const chemblId = typeof molecule.molecule_chembl_id === 'string'
    ? molecule.molecule_chembl_id.trim()
    : '';
  if (!chemblId) return null;
  const structures = molecule.molecule_structures && typeof molecule.molecule_structures === 'object'
    ? molecule.molecule_structures
    : {};
  const smiles = typeof structures.canonical_smiles === 'string'
    ? structures.canonical_smiles.trim()
    : '';
  if (!smiles) return null;
  const inchiKey = typeof structures.standard_inchi_key === 'string'
    ? structures.standard_inchi_key.trim()
    : '';
  const upstreamSimilarity = molecule.similarity !== undefined && molecule.similarity !== null
    ? Number(molecule.similarity)
    : null;
  return {
    chemblId,
    smiles,
    inchiKey: inchiKey || null,
    upstreamSimilarityPercent: Number.isFinite(upstreamSimilarity) ? upstreamSimilarity : null,
    sourceUrl: chemblCompoundUrl(chemblId),
  };
}

/**
 * Re-score candidates with the declared Morgan settings, filter by threshold,
 * deduplicate, and sort. Returns { results, stats }.
 */
export function rescoreAndRank({
  RDKit,
  querySmiles,
  candidates,
  threshold,
  maxResults,
}) {
  const details = morganDetailsJson();
  const query = validateAndFingerprint(RDKit, querySmiles, details);
  if (!query) {
    throw new OpenCompoundsValidationError(
      'This structure cannot be searched. Check atom charges and bond orders. A structure may display in the editor but still fail chemical validation.'
    );
  }

  const seen = new Set();
  const scored = [];
  let droppedInvalid = 0;
  let droppedBelow = 0;
  let droppedDup = 0;

  for (const candidate of candidates) {
    if (!candidate) continue;
    const validated = validateAndFingerprint(RDKit, candidate.smiles, details);
    if (!validated) {
      droppedInvalid += 1;
      continue;
    }
    const similarity = tanimotoUint8(query.fpUint8, validated.fpUint8);
    if (similarity === null || similarity < threshold) {
      droppedBelow += 1;
      continue;
    }
    const identity = candidate.inchiKey || validated.smiles;
    if (seen.has(identity)) {
      droppedDup += 1;
      continue;
    }
    seen.add(identity);
    scored.push({
      chemblId: candidate.chemblId,
      smiles: validated.smiles,
      inchiKey: candidate.inchiKey,
      similarity,
      source: OPEN_COMPOUNDS_SOURCE,
      sourceLabel: OPEN_COMPOUNDS_SOURCE_LABEL,
      sourceUrl: candidate.sourceUrl || chemblCompoundUrl(candidate.chemblId),
      molblock: validated.molblock,
      upstreamSimilarityPercent: candidate.upstreamSimilarityPercent,
    });
  }

  scored.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return String(a.chemblId).localeCompare(String(b.chemblId));
  });

  const truncated = scored.length > maxResults;
  const results = scored.slice(0, maxResults).map((row, index) => ({
    rank: index + 1,
    chemblId: row.chemblId,
    smiles: row.smiles,
    inchiKey: row.inchiKey,
    similarity: row.similarity,
    source: row.source,
    sourceLabel: row.sourceLabel,
    sourceUrl: row.sourceUrl,
    molblock: row.molblock,
  }));

  return {
    querySmilesCanonical: query.smiles,
    results,
    stats: {
      candidatesReceived: candidates.length,
      droppedInvalid,
      droppedBelowThreshold: droppedBelow,
      droppedDuplicates: droppedDup,
      rankedBeforeCap: scored.length,
      returned: results.length,
      truncatedToMaxResults: truncated,
    },
  };
}

/**
 * Fetch ChEMBL similarity pages until retrieval cap or exhaustion.
 * `fetchImpl(url, opts)` must return a Response-like { ok, status, text(), json() }.
 */
export async function fetchChemblCandidates({
  baseUrl,
  smiles,
  threshold,
  fetchImpl,
  retrievalCap = OPEN_CHEMBL_RETRIEVAL_CAP,
  pageSize = OPEN_CHEMBL_RETRIEVAL_PAGE,
  timeoutMs = OPEN_CHEMBL_TIMEOUT_MS,
}) {
  const thresholdPercent = Math.max(40, Math.min(100, Math.round(threshold * 100)));
  const candidates = [];
  let offset = 0;
  let totalCount = null;
  let truncatedByCap = false;
  let pages = 0;

  while (candidates.length < retrievalCap) {
    const limit = Math.min(pageSize, retrievalCap - candidates.length);
    const url = buildChemblSimilarityUrl({
      baseUrl,
      smiles,
      thresholdPercent,
      offset,
      limit,
    });
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'PyxisDiscovery-OpenCompounds/1.0 (research; contact via pyxis-discovery.com)',
        },
        timeoutMs,
      });
    } catch (error) {
      if (candidates.length > 0) {
        throw new OpenCompoundsUpstreamError(
          `ChEMBL request failed after partial retrieval: ${error?.message || error}`,
          { status: 502, partial: true }
        );
      }
      throw new OpenCompoundsUpstreamError(
        `ChEMBL is unreachable: ${error?.message || error}`,
        { status: 502 }
      );
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const relayed = relayOpenUpstreamStatus(response.status);
      const detail = typeof payload?.error === 'string'
        ? payload.error
        : (typeof payload === 'string' ? payload.slice(0, 200) : `HTTP ${response.status}`);
      if (candidates.length > 0) {
        throw new OpenCompoundsUpstreamError(
          `ChEMBL returned HTTP ${response.status} after partial retrieval (${detail})`,
          { status: relayed, partial: true }
        );
      }
      if (response.status === 400) {
        throw new OpenCompoundsValidationError(
          'ChEMBL rejected this structure. Check the SMILES and try again.'
        );
      }
      throw new OpenCompoundsUpstreamError(
        `ChEMBL search failed (${detail})`,
        { status: relayed }
      );
    }

    const molecules = Array.isArray(payload?.molecules) ? payload.molecules : [];
    const meta = payload?.page_meta || {};
    if (Number.isFinite(Number(meta.total_count))) {
      totalCount = Number(meta.total_count);
    }
    pages += 1;

    for (const molecule of molecules) {
      const candidate = chemblMoleculeToCandidate(molecule);
      if (candidate) candidates.push(candidate);
    }

    if (molecules.length < limit) break;
    offset += molecules.length;
    if (totalCount !== null && offset >= totalCount) break;
    if (candidates.length >= retrievalCap) {
      truncatedByCap = true;
      break;
    }
    // Safety: avoid runaway pagination
    if (pages >= 10) {
      truncatedByCap = true;
      break;
    }
  }

  return {
    candidates,
    retrieval: {
      provider: OPEN_COMPOUNDS_SOURCE,
      endpoint: 'similarity',
      thresholdPercent,
      totalCountReported: totalCount,
      pagesFetched: pages,
      candidatesKept: candidates.length,
      retrievalCap,
      truncatedByRetrievalCap: truncatedByCap
        || (totalCount !== null && totalCount > candidates.length),
      rankingNote:
        'Ranked among ChEMBL-retrieved candidates after local RDKit Morgan (r=2, 2048-bit) Tanimoto re-scoring — not guaranteed exhaustive database-wide top-N.',
    },
  };
}

/** Build the public status payload. Pass `aiRuntime` from resolveOpenCompoundsAiRuntime. */
export function buildOpenCompoundsStatus(config = openCompoundsConfig(), aiRuntime = null) {
  const ai = aiRuntime
    ? {
        enabled: Boolean(aiRuntime.enabled),
        reason: aiRuntime.reason,
        provider: aiRuntime.provider,
        model: aiRuntime.enabled ? aiRuntime.model : aiRuntime.model,
        allowPaid: Boolean(aiRuntime.allowPaid),
        deterministicFallbackLabel: 'Search without AI',
      }
    : {
        enabled: false,
        reason: 'AI runtime was not resolved.',
        provider: config.ai?.provider || null,
        model: config.ai?.model || null,
        allowPaid: false,
        deterministicFallbackLabel: 'Search without AI',
      };

  return {
    available: Boolean(config.enabled && config.baseUrl),
    source: OPEN_COMPOUNDS_SOURCE,
    sourceLabel: OPEN_COMPOUNDS_SOURCE_LABEL,
    fingerprint: OPEN_COMPOUNDS_FINGERPRINT,
    attribution: OPEN_COMPOUNDS_ATTRIBUTION,
    maxResults: OPEN_SIMILARITY_MAX_RESULTS,
    minThreshold: OPEN_SIMILARITY_MIN_THRESHOLD,
    sendsQueryExternally: true,
    externalDestination: ai.enabled
      ? 'AI provider (tool loop) and ChEMBL Data Web Services (EMBL-EBI)'
      : 'ChEMBL Data Web Services (EMBL-EBI)',
    rankingNote:
      'Results are ranked among retrieved ChEMBL candidates after local RDKit re-scoring, not guaranteed exhaustive database-wide top-N.',
    ai,
    ...(config.enabled ? {} : { reason: 'Open compounds search is disabled (OPEN_COMPOUNDS_ENABLED=false).' }),
  };
}

/** CSV for a ranked result page (matches displayed scientific fields). */
export function resultsToCsv({ querySmiles, threshold, results, fingerprint = OPEN_COMPOUNDS_FINGERPRINT }) {
  const header = [
    'rank',
    'chembl_id',
    'source',
    'source_url',
    'smiles',
    'inchikey',
    'similarity_tanimoto',
    'fingerprint_type',
    'fingerprint_radius',
    'fingerprint_nBits',
    'fingerprint_useChirality',
    'query_smiles',
    'threshold',
  ];
  const escapeCsvCell = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [header.join(',')];
  for (const row of results) {
    lines.push([
      row.rank,
      row.chemblId,
      row.sourceLabel || OPEN_COMPOUNDS_SOURCE_LABEL,
      row.sourceUrl,
      row.smiles,
      row.inchiKey || '',
      typeof row.similarity === 'number' ? row.similarity.toFixed(6) : '',
      fingerprint.type,
      fingerprint.radius,
      fingerprint.nBits,
      fingerprint.useChirality,
      querySmiles,
      threshold,
    ].map(escapeCsvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Multi-molecule SDF from already-validated molblocks.
 * Does not claim docking-ready — structures are 2D depictions from RDKit parse.
 */
export function resultsToSdf(results) {
  const blocks = [];
  for (const row of results) {
    if (!row.molblock || typeof row.molblock !== 'string') {
      throw new OpenCompoundsValidationError(
        `Missing validated molblock for ${row.chemblId || 'compound'}; refusing to invent SDF coordinates`
      );
    }
    let block = row.molblock.replace(/\r\n/g, '\n').trimEnd();
    if (!block.endsWith('$$$$')) {
      // Attach provenance properties before the terminator
      const props = [
        `> <CHEMBL_ID>\n${row.chemblId}\n`,
        `> <SMILES>\n${row.smiles}\n`,
        `> <SIMILARITY_TANIMOTO>\n${typeof row.similarity === 'number' ? row.similarity.toFixed(6) : ''}\n`,
        `> <SOURCE>\n${OPEN_COMPOUNDS_SOURCE_LABEL}\n`,
        `> <SOURCE_URL>\n${row.sourceUrl}\n`,
        `> <FINGERPRINT>\nMorgan radius=${OPEN_COMPOUNDS_FINGERPRINT.radius} nBits=${OPEN_COMPOUNDS_FINGERPRINT.nBits} useChirality=${OPEN_COMPOUNDS_FINGERPRINT.useChirality}\n`,
        `> <DOCKING_READY>\nfalse\n`,
      ].join('\n');
      if (block.includes('$$$$')) {
        block = block.replace(/\$\$\$\$\s*$/, `${props}\n$$$$`);
      } else {
        block = `${block}\n${props}\n$$$$`;
      }
    }
    blocks.push(block.trimEnd());
  }
  return `${blocks.join('\n')}\n`;
}

/**
 * Run the full search pipeline and return a paginated response body.
 */
export async function runOpenCompoundsSearch({
  config,
  params,
  fetchImpl,
  rdkitLoader = loadRDKit,
}) {
  if (!config.enabled) {
    throw new OpenCompoundsUnavailableError(
      'Open compounds search is disabled (OPEN_COMPOUNDS_ENABLED=false).'
    );
  }
  if (!config.baseUrl) {
    throw new OpenCompoundsUnavailableError('OPEN_COMPOUNDS_BASE is not configured');
  }

  const RDKit = await rdkitLoader();
  // Validate query early so we do not call ChEMBL with unparseable SMILES.
  const early = validateAndFingerprint(RDKit, params.smiles);
  if (!early) {
    throw new OpenCompoundsValidationError(
      'This structure cannot be searched. Check atom charges and bond orders. A structure may display in the editor but still fail chemical validation.'
    );
  }

  const { candidates, retrieval } = await fetchChemblCandidates({
    baseUrl: config.baseUrl,
    smiles: params.smiles,
    threshold: params.threshold,
    fetchImpl,
  });

  const ranked = rescoreAndRank({
    RDKit,
    querySmiles: params.smiles,
    candidates,
    threshold: params.threshold,
    maxResults: params.maxResults,
  });

  const page = ranked.results.slice(params.offset, params.offset + params.limit);
  const hasMore = params.offset + page.length < ranked.results.length;

  return {
    found: ranked.results.length > 0,
    count: page.length,
    total: ranked.results.length,
    offset: params.offset,
    limit: params.limit,
    maxResults: params.maxResults,
    hasMore,
    query_smiles: params.smiles,
    query_smiles_canonical: ranked.querySmilesCanonical,
    threshold: params.threshold,
    fingerprint: OPEN_COMPOUNDS_FINGERPRINT,
    source: OPEN_COMPOUNDS_SOURCE,
    sourceLabel: OPEN_COMPOUNDS_SOURCE_LABEL,
    attribution: OPEN_COMPOUNDS_ATTRIBUTION,
    sendsQueryExternally: true,
    retrieval,
    stats: ranked.stats,
    results: page.map(({ molblock, ...rest }) => rest),
    // molblocks kept only for export helpers — not in default JSON page
    _molblocksById: Object.fromEntries(
      page.filter((r) => r.molblock).map((r) => [r.chemblId, r.molblock])
    ),
  };
}
