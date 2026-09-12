#!/usr/bin/env bun
/**
 * Manual live re-verification of the stock fingerprint/metric matrix against a
 * tonomitosql search service (docs/DATA-STOCK-COMPOUNDS.md → "Fingerprint and
 * metric selectors", docs/REFERENCE-STOCK-FP-METRICS.md).
 *
 * WHY THIS EXISTS
 * ---------------
 * The 2026-09-12 selector work was gated on a live 12-combo matrix
 * (6 fingerprints × 2 metrics) measured against the stock dataset. Host
 * capacity (DiskFull / statement timeout) made some cells fail at threshold
 * 0.3 while succeeding at 0.5, and any future engine/host change can shift
 * them again. This script re-runs the same evidence pass on demand. It is an
 * EVIDENCE PRINTER, not a gate: it exits 0 as long as it could talk to the
 * service — a cell reporting HTTP 500 is recorded as "host capacity/timeout",
 * NOT as "unsupported" (those are different claims; see the reference doc).
 *
 * NOT FOR CI. It performs real searches against a real service and can be
 * slow/expensive on the heavy fingerprints (maccs, rdkit×dice).
 *
 * USAGE
 * -----
 *   STOCK_SEARCH_BASE=http://... bun scripts/verify-stock-fp-metrics.mjs \
 *     [--smiles "O=C1NC2C(NCCC2)CC1"] [--threshold 0.3] [--base-url http://...] [-h]
 *
 * Base URL resolution order: --base-url flag → STOCK_SEARCH_BASE →
 * TANIMOTO_API_BASE (same envs server/utils/stockSearch.js uses). No default
 * host is hardcoded here on purpose.
 *
 * Dataset resolution: STOCK_SEARCH_DATASET_ID (numeric) wins; otherwise the
 * dataset is discovered by name via GET /v1/datasets using
 * STOCK_SEARCH_DATASET_NAME (default "Stock compounds — 2026-09-01", the
 * importer default).
 *
 * Count semantics: the engine's `count` field is page-limited
 * (count = len(results)), so each combo first queries limit=1; if that finds
 * anything, a second limit=1000 call counts the real first page (1000 returned
 * → reported as "≥1000").
 *
 * After the matrix it paginates the full morgan/tanimoto ranking (limit 1000,
 * offset until a short page) and reports the overlap with Anna's 30 reported
 * MOE btanimoto IDs from
 * server/test/fixtures/anna-moe-btanimoto-reference.json.
 *
 * Exit codes: 0 evidence printed · 1 usage error · 2 network/service error.
 */

import { readFileSync } from 'node:fs';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DATASET_NAME = 'Stock compounds — 2026-09-01';
const DEFAULT_SMILES = 'O=C1NC2C(NCCC2)CC1'; // Anna's query, 2026-09-12
const DEFAULT_THRESHOLD = 0.3;
const PAGE_LIMIT = 1000; // engine MAX_LIMIT
const FP_TYPES = ['morgan', 'maccs', 'feat_morgan', 'atom_pair', 'torsion', 'rdkit'];
const METRICS = ['tanimoto', 'dice'];
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // heavy combos can run minutes host-side
const MAX_FULL_PAGES = 200; // safety stop for the full-ranking pagination

const REFERENCE_DOC = 'docs/REFERENCE-STOCK-FP-METRICS.md';
const FIXTURE_PATH = 'server/test/fixtures/anna-moe-btanimoto-reference.json'; // repo-relative, for display

const USAGE = `Usage:
  STOCK_SEARCH_BASE=<tonomitosql base url> bun scripts/verify-stock-fp-metrics.mjs \\
      [--smiles "<smiles>"] [--threshold 0.3] [--base-url <url>]

Env:
  STOCK_SEARCH_BASE           tonomitosql base URL holding the stock dataset
  TANIMOTO_API_BASE           fallback base URL (same as server config)
  STOCK_SEARCH_DATASET_ID     pin the dataset by numeric id (else discover by name)
  STOCK_SEARCH_DATASET_NAME   dataset name (default "${DEFAULT_DATASET_NAME}")

Flags:
  --smiles <s>     query SMILES (default: Anna's 2026-09-12 query)
  --threshold <n>  similarity threshold 0 < t <= 1 (default ${DEFAULT_THRESHOLD})
  --base-url <u>   override env base URL (e.g. an isolated scratch stack)
  -h | --help      this message`;

// ── Arg/env parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { smiles: DEFAULT_SMILES, threshold: DEFAULT_THRESHOLD, baseUrl: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--smiles') opts.smiles = argv[++i] ?? '';
    else if (arg === '--threshold') opts.threshold = argv[++i] ?? '';
    else if (arg === '--base-url') opts.baseUrl = argv[++i] ?? '';
    else throw new Error(`unknown argument: ${arg}`);
  }
  const threshold = Number(opts.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error(`--threshold must be a number in (0, 1], got "${opts.threshold}"`);
  }
  opts.threshold = threshold;
  if (!opts.smiles || !opts.smiles.trim()) throw new Error('--smiles must be a non-empty SMILES string');
  opts.smiles = opts.smiles.trim();
  return opts;
}

function resolveBaseUrl(opts) {
  const base = (opts.baseUrl || process.env.STOCK_SEARCH_BASE || process.env.TANIMOTO_API_BASE || '').trim();
  if (!base) {
    console.error('No search-service base URL. Set STOCK_SEARCH_BASE (or TANIMOTO_API_BASE), or pass --base-url.');
    console.error(USAGE);
    process.exit(1);
  }
  return base.replace(/\/+$/, '');
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function getJson(url) {
  // Network-level failures throw (caller decides exit code); HTTP error
  // statuses are RETURNED as evidence — a 500 is a finding, not a crash.
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  return { status: response.status, body };
}

function similarityUrl({ baseUrl, datasetId, smiles, threshold, offset, limit, fingerprintType, similarityMetric }) {
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

function stockCodeOf(item) {
  const meta = item?.metadata ?? {};
  return meta.MAIN_BAS ?? meta.compound_id ?? meta.ID ?? String(item?.molecule_id ?? '');
}

// ── Measurement ──────────────────────────────────────────────────────────────

async function resolveDataset(baseUrl) {
  const idEnv = Number(process.env.STOCK_SEARCH_DATASET_ID);
  if (Number.isInteger(idEnv) && idEnv > 0) {
    console.log(`Dataset: pinned by STOCK_SEARCH_DATASET_ID=${idEnv}`);
    return idEnv;
  }
  const name = (process.env.STOCK_SEARCH_DATASET_NAME || DEFAULT_DATASET_NAME).trim();
  const { status, body } = await getJson(`${baseUrl}/v1/datasets`);
  if (status !== 200) throw new Error(`GET /v1/datasets returned HTTP ${status}`);
  const datasets = Array.isArray(body?.datasets) ? body.datasets : [];
  const match = datasets.find((d) => d.name === name);
  if (!match) {
    throw new Error(
      `No dataset named "${name}" on ${baseUrl} (found: ${datasets.map((d) => `#${d.id} ${d.name}`).join(', ') || 'none'}). ` +
      'Set STOCK_SEARCH_DATASET_NAME / STOCK_SEARCH_DATASET_ID.'
    );
  }
  console.log(`Dataset: #${match.id} "${match.name}" (${match.row_count} rows)`);
  return match.id;
}

/** One matrix cell: limit=1 probe, then a full page when anything is found. */
async function measureCombo(ctx, fingerprintType, similarityMetric) {
  const probe = await getJson(similarityUrl({ ...ctx, offset: 0, limit: 1, fingerprintType, similarityMetric }));
  if (probe.status === 500) {
    return { text: 'failed (host capacity/timeout) — NOT unsupported', hits: null };
  }
  if (probe.status !== 200) {
    return { text: `HTTP ${probe.status}`, hits: null };
  }
  const { found, count } = probe.body ?? {};
  if (!found || !count) return { text: '0', hits: 0 };
  // count is page-limited (count = len(results)), so the probe only proves
  // ≥1 hit — fetch a full page for the real first-page count.
  const full = await getJson(similarityUrl({ ...ctx, offset: 0, limit: PAGE_LIMIT, fingerprintType, similarityMetric }));
  if (full.status !== 200) {
    return { text: `probe 200 but full page HTTP ${full.status}`, hits: null };
  }
  const returned = Array.isArray(full.body?.results) ? full.body.results.length : 0;
  return returned >= PAGE_LIMIT
    ? { text: `≥${PAGE_LIMIT} (page-limited)`, hits: PAGE_LIMIT }
    : { text: String(returned), hits: returned };
}

async function measureFullMorganTanimoto(ctx) {
  const items = [];
  for (let page = 0; page < MAX_FULL_PAGES; page++) {
    const offset = page * PAGE_LIMIT;
    const { status, body } = await getJson(
      similarityUrl({ ...ctx, offset, limit: PAGE_LIMIT, fingerprintType: 'morgan', similarityMetric: 'tanimoto' })
    );
    if (status !== 200) throw new Error(`morgan/tanimoto page @offset ${offset} returned HTTP ${status}`);
    const results = Array.isArray(body?.results) ? body.results : [];
    items.push(...results);
    if (results.length < PAGE_LIMIT) break;
  }
  return items;
}

function overlap(ourIds, herIds) {
  const ours = new Set(ourIds);
  const hers = new Set(herIds);
  return {
    shared: ourIds.filter((id) => hers.has(id)),
    absentFromOurs: herIds.filter((id) => !ours.has(id)),
    notInAnna30: ourIds.filter((id) => !hers.has(id)),
  };
}

function printIdList(label, ids) {
  const shown = ids.slice(0, 40);
  console.log(`  ${label}: ${ids.length}${ids.length ? '' : ' (none)'}`);
  if (shown.length) console.log(`    ${shown.join(', ')}${ids.length > shown.length ? ` … (+${ids.length - shown.length} more)` : ''}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const baseUrl = resolveBaseUrl(opts);
  console.log(`Stock fingerprint/metric matrix verification — ${new Date().toISOString().slice(0, 10)}`);
  console.log(`Service: ${baseUrl}`);

  const datasetId = await resolveDataset(baseUrl);
  const ctx = { baseUrl, datasetId, smiles: opts.smiles, threshold: opts.threshold };
  console.log(`Query: ${opts.smiles}  threshold: ${opts.threshold}\n`);

  // 1) The 12-combo matrix, sequentially (heavy combos hammer the host).
  console.log(`| ${'fingerprint'.padEnd(12)} | ${'metric'.padEnd(8)} | result |`);
  console.log('|--------------|----------|--------|');
  for (const fingerprintType of FP_TYPES) {
    for (const similarityMetric of METRICS) {
      const { text } = await measureCombo(ctx, fingerprintType, similarityMetric);
      console.log(`| ${fingerprintType.padEnd(12)} | ${similarityMetric.padEnd(8)} | ${text} |`);
    }
  }

  // 2) Full morgan/tanimoto ranking + overlap with Anna's 30 btanimoto IDs.
  console.log('\nFull morgan/tanimoto ranking …');
  const items = await measureFullMorganTanimoto(ctx);
  const ourIds = items.map(stockCodeOf);
  console.log(`Total hits (paginated, offset until short page): ${items.length}`);

  const fixture = JSON.parse(readFileSync(new URL(`../${FIXTURE_PATH}`, import.meta.url), 'utf8'));
  const herIds = fixture.moe.btanimoto.ids;
  const { shared, absentFromOurs, notInAnna30 } = overlap(ourIds, herIds);
  console.log(`\nOverlap with Anna's ${herIds.length} reported MOE btanimoto IDs (threshold ${fixture.moe.btanimoto.threshold}):`);
  printIdList('shared', shared);
  printIdList('in her 30 but not in this ranking', absentFromOurs);
  printIdList('in this ranking but not in her 30', notInAnna30);

  // 3) Summary — cite the reference record so the evidence lands somewhere.
  const baseline = fixture.liveVerification;
  console.log('\nSummary');
  console.log('-------');
  console.log(`Reference record: ${REFERENCE_DOC} (+ ${FIXTURE_PATH})`);
  console.log(
    `2026-09-12 baseline there: morgan/tanimoto @0.3 = ${baseline.morganTanimoto030.hitCount} hits ` +
    `(reproduces her Pyxis report), ${baseline.overlapWithMoeBtanimoto.sharedCount} shared with her 30; ` +
    `maccs×2 and rdkit/dice failed at 0.3 on host capacity and verified @0.5.`
  );
  console.log(
    'A 500 above is a host capacity/timeout finding, NOT "unsupported" — the reference doc records the same ' +
    'combos returning 200 at threshold 0.5. Compare cell-by-cell before treating any drift as a code change.'
  );
  console.log('Anna\'s MOE numbers are attributed reference data, not a reproducibility target.');
  process.exit(0);
}

main().catch((error) => {
  console.error(`Network/service error: ${error?.message || error}`);
  console.error('(Usage:)');
  console.error(USAGE);
  process.exit(2);
});
