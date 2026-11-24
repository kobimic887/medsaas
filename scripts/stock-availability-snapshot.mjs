#!/usr/bin/env node
/**
 * Build a validated per-compound stock availability snapshot from a CompChem
 * vial-level SDF dump (`STRUCTURES_FullDump_<YYYYMMDD>_<records>.zip`).
 *
 * OFFLINE ONLY. This tool reads a file (or stdin) and writes a snapshot directory.
 * It calls no service and does not change what the app offers: search offers
 * still use CURRENT_TOT_NETTO_MG imported into the stock search dataset
 * (server/utils/compoundShopSearch.js). Wiring a snapshot into offers is a
 * separate, owner-approved change (see docs/STOCK-AVAILABILITY.md).
 *
 * Why a separate snapshot: the stock dataset import computes fingerprints for
 * ~630k structures (measured ~12.5 h) and the search service has no
 * metadata-only update, so a weekly availability feed cannot be a re-import.
 *
 * Input format (pinned): one SDF record per vial. Data tags vary per record
 * (optional batch, salt and exclusivity fields), so REQUIRED_TAGS must be present
 * in each record and every tag must belong to KNOWN_TAGS. A tag outside that
 * vocabulary is a format change: the run fails after counting it unless
 * --allow-new-tags is given after review. Amounts are per vial; this tool sums
 * them per MAIN_BAS into CURRENT_TOT_NETTO_MG / CURRENT_TOT_AMOUNT_UM, the
 * per-compound names the app already uses.
 *
 * Safety:
 * - A run that fails validation writes nothing. Output is written to a temp
 *   directory and renamed into place only after every check passes.
 * - An existing snapshot for the same date is never overwritten: identical
 *   source bytes → verified no-op (exit 0); different bytes → refusal unless
 *   --replace.
 * - --previous compares with an earlier snapshot CSV (or the original
 *   STRUCTURES_*_unique.txt) and refuses large compound losses unless
 *   --allow-large-change is given after review.
 *
 * Usage:
 *   unzip -p STRUCTURES_FullDump_20261026_1165950.zip \
 *     | bun scripts/stock-availability-snapshot.mjs --input - \
 *         --source-name STRUCTURES_FullDump_20261026_1165950.zip --out-dir /data/availability \
 *         [--previous /data/availability/2026-09-01/availability.csv]
 *   bun scripts/stock-availability-snapshot.mjs --input dump.sdf --as-of 2026-10-26 --out-dir …
 *
 * Exit codes: 0 written or verified no-op · 1 validation/guard failure · 2 usage/IO error.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { workbookPacksForRow } from '../shared/compoundPriceBook.js';

export const SNAPSHOT_FORMAT = 'pyxis-stock-availability-v1';
export const REQUIRED_TAGS = Object.freeze(['MAIN_BAS', 'VIAL', 'CURRENT_AMOUNT_UM', 'CURRENT_NETTO_MG']);
// Every tag observed in the 2026-09-01 and 2026-10-26 CompChem dumps.
export const KNOWN_TAGS = Object.freeze([
  'ELE_ID', 'MAIN_BAS', 'VIAL', 'BOX_ID', 'BOX', 'PYX_BOX_ID', 'CELL', 'BATCH', 'BATCH_PURITY_%',
  'MW_BATCH', 'MW_STRUCTURE', 'IUPAC_NAME', 'SALT_NOTATION', 'EXCLUSIVITY',
  'T0_AMOUNT_UM', 'T0_NETTO_MG', 'CURRENT_AMOUNT_UM', 'CURRENT_NETTO_MG',
]);
export const SNAPSHOT_HEADER = ['MAIN_BAS', 'CURRENT_TOT_NETTO_MG', 'CURRENT_TOT_AMOUNT_UM', 'VIALS'];
// Offers are minted only when the snapshot holds at least 1 mg (compoundShopOffers.js).
export const MIN_OFFER_MG = 1;
const MAIN_BAS = /^[A-Z]{3} \d{6,9}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DUMP_NAME = /^STRUCTURES_FullDump_(\d{4})(\d{2})(\d{2})_(\d+)\.(?:zip|sdf)$/;
const MAX_REJECT_SAMPLES = 200;

export class SnapshotError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'SnapshotError'; this.details = details; }
}

/** Date and expected record count encoded in a CompChem dump file name. */
export function parseDumpName(name) {
  const match = DUMP_NAME.exec(path.basename(String(name || '')));
  if (!match) return null;
  const [, y, m, d, count] = match;
  const asOf = `${y}-${m}-${d}`;
  const date = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== asOf) return null;
  return { asOf, expectedRecords: Number(count) };
}

/** Async iterator of { index, tags } for each SDF record; molblocks are skipped. */
export async function* readSdfRecords(lines) {
  let index = 0; let inData = false; let tags = new Map(); let current = null; let value = [];
  const flush = () => { if (current !== null) tags.set(current, (tags.has(current) ? null : value.join('\n'))); current = null; value = []; };
  for await (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '$$$$') {
      flush();
      index += 1;
      yield { index, tags };
      inData = false; tags = new Map();
      continue;
    }
    if (!inData) { if (line.startsWith('M  END')) inData = true; continue; }
    const header = /^>\s*<([^>]+)>/.exec(line);
    if (header) { flush(); current = header[1]; continue; }
    if (current !== null) { if (line === '') flush(); else value.push(line); }
  }
  if (inData || tags.size) throw new SnapshotError('Input ended inside an SDF record (truncated file?).');
}

function decimal(text) {
  if (typeof text !== 'string' || !DECIMAL.test(text.trim())) return null;
  const number = Number(text.trim());
  return Number.isFinite(number) && number <= 1e9 ? number : null;
}

/** Validate one vial record. Returns { vial } or { reason }; unknown tags are reported by the caller. */
export function validateRecord(tags) {
  const missing = REQUIRED_TAGS.find((name) => !tags.has(name));
  if (missing) return { reason: `missing_${missing}` };
  if ([...tags.values()].some((v) => v === null)) return { reason: 'repeated_tag' };
  const code = tags.get('MAIN_BAS').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!MAIN_BAS.test(code)) return { reason: 'invalid_main_bas' };
  const vial = tags.get('VIAL').trim();
  if (!/^\d{1,20}$/.test(vial)) return { reason: 'invalid_vial' };
  const mg = decimal(tags.get('CURRENT_NETTO_MG'));
  if (mg === null) return { reason: tags.get('CURRENT_NETTO_MG').trim() === '' ? 'missing_mg' : 'invalid_mg' };
  const um = decimal(tags.get('CURRENT_AMOUNT_UM'));
  if (um === null) return { reason: tags.get('CURRENT_AMOUNT_UM').trim() === '' ? 'missing_um' : 'invalid_um' };
  return { vial: { code, vial, mg, um } };
}

/** Workbook price category for a stock code, or null when the code cannot be offered. */
export function stockPriceCategory(code) {
  return workbookPacksForRow('stock', code)?.category ?? null;
}

// Source amounts are float32 text (8.3999996, 3.4000001); 4 decimals removes that noise.
const round = (n) => Math.round(n * 1e4) / 1e4;
// Amounts closer than this are the same measurement for change reporting.
const SAME_MG = 0.005;

/** Aggregate vial records into a per-compound snapshot plus a report. */
export async function buildSnapshot(lines, { maxRejectRate = 0.001, allowNewTags = false } = {}) {
  const compounds = new Map(); const vials = new Set(); const unknownTags = {}; const optionalTags = {};
  const rejects = { total: 0, byReason: {}, samples: [] };
  let records = 0;
  for await (const { index, tags } of readSdfRecords(lines)) {
    records += 1;
    for (const name of tags.keys()) {
      if (!KNOWN_TAGS.includes(name)) unknownTags[name] = (unknownTags[name] || 0) + 1;
      else if (!REQUIRED_TAGS.includes(name)) optionalTags[name] = (optionalTags[name] || 0) + 1;
    }
    let result = validateRecord(tags);
    if (result.vial && vials.has(result.vial.vial)) result = { reason: 'duplicate_vial' };
    if (result.reason) {
      rejects.total += 1;
      rejects.byReason[result.reason] = (rejects.byReason[result.reason] || 0) + 1;
      if (rejects.samples.length < MAX_REJECT_SAMPLES) rejects.samples.push({ record: index, reason: result.reason, MAIN_BAS: tags.get('MAIN_BAS') ?? null, VIAL: tags.get('VIAL') ?? null });
      continue;
    }
    const { code, vial, mg, um } = result.vial;
    vials.add(vial);
    const entry = compounds.get(code) || { mg: 0, um: 0, vials: 0 };
    entry.mg += mg; entry.um += um; entry.vials += 1;
    compounds.set(code, entry);
  }
  if (!records) throw new SnapshotError('Input contained no SDF records.');
  if (Object.keys(unknownTags).length && !allowNewTags) {
    throw new SnapshotError('The dump contains SDF tags outside the known CompChem vocabulary; review the format, then add them to KNOWN_TAGS or rerun with --allow-new-tags.', { unknownTags });
  }
  const rejectRate = rejects.total / records;
  if (rejectRate > maxRejectRate) {
    throw new SnapshotError(`Rejected ${rejects.total} of ${records} records (${(rejectRate * 100).toFixed(3)}%), above the ${(maxRejectRate * 100).toFixed(3)}% limit.`, { rejects });
  }
  const rows = [...compounds.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([code, e]) => ({ code, mg: round(e.mg), um: round(e.um), vials: e.vials }));
  const families = {};
  for (const row of rows) {
    const prefix = row.code.slice(0, 3);
    if (!families[prefix]) families[prefix] = { compounds: 0, offerable: 0, priceCategory: stockPriceCategory(row.code) };
    const family = families[prefix];
    family.compounds += 1;
    if (row.mg >= MIN_OFFER_MG && family.priceCategory) family.offerable += 1;
  }
  return {
    rows,
    report: {
      records, acceptedVials: records - rejects.total, compounds: rows.length,
      offerableCompounds: rows.filter((r) => r.mg >= MIN_OFFER_MG && stockPriceCategory(r.code)).length,
      belowOfferMinimum: rows.filter((r) => r.mg < MIN_OFFER_MG).length,
      rejects, families, optionalTags, unknownTags,
    },
  };
}

export function snapshotCsv(rows) {
  return `${SNAPSHOT_HEADER.join(',')}\n${rows.map((r) => `${r.code},${r.mg},${r.um},${r.vials}`).join('\n')}\n`;
}

/**
 * Read a previous snapshot: this tool's CSV, or the per-compound
 * STRUCTURES_<date>_unique.txt TSV used by import-stock-compounds.mjs.
 */
export async function readPrevious(lines) {
  const map = new Map(); let header = null; let codeAt; let mgAt; let sep;
  for await (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (header === null) {
      sep = line.includes('\t') ? '\t' : ',';
      header = line.split(sep);
      codeAt = header.indexOf('MAIN_BAS'); mgAt = header.indexOf('CURRENT_TOT_NETTO_MG');
      if (codeAt < 0 || mgAt < 0) throw new SnapshotError('Previous snapshot needs MAIN_BAS and CURRENT_TOT_NETTO_MG columns.');
      continue;
    }
    if (!line) continue;
    const fields = line.split(sep);
    const code = fields[codeAt]?.trim().toUpperCase().replace(/\s+/g, ' ');
    const mg = decimal(fields[mgAt]);
    if (!code || mg === null) throw new SnapshotError(`Previous snapshot has an unreadable row: ${line.slice(0, 120)}`);
    map.set(code, mg);
  }
  if (!map.size) throw new SnapshotError('Previous snapshot is empty.');
  return map;
}

/** Compare a new snapshot with the previous per-compound amounts. */
export function diffSnapshots(rows, previous) {
  const next = new Map(rows.map((r) => [r.code, r.mg]));
  const was = (mg) => mg >= MIN_OFFER_MG;
  const diff = { previousCompounds: previous.size, added: 0, removed: 0, increased: 0, decreased: 0, unchanged: 0, lostOffer: 0, gainedOffer: 0, removedSamples: [], lostOfferSamples: [] };
  for (const [code, mg] of previous) {
    if (!next.has(code)) {
      diff.removed += 1;
      if (was(mg)) { diff.lostOffer += 1; if (diff.removedSamples.length < 20) diff.removedSamples.push(code); }
      continue;
    }
    const now = next.get(code);
    if (Math.abs(now - mg) < SAME_MG) diff.unchanged += 1; else if (now > mg) diff.increased += 1; else diff.decreased += 1;
    if (was(mg) && !was(now)) { diff.lostOffer += 1; if (diff.lostOfferSamples.length < 20) diff.lostOfferSamples.push(code); }
    if (!was(mg) && was(now)) diff.gainedOffer += 1;
  }
  for (const [code, mg] of next) if (!previous.has(code)) { diff.added += 1; if (was(mg)) diff.gainedOffer += 1; }
  diff.removedRate = previous.size ? diff.removed / previous.size : 0;
  return diff;
}

function linesOf(input) {
  const stream = input === '-' ? process.stdin : createReadStream(input);
  return { stream, lines: readline.createInterface({ input: stream, crlfDelay: Infinity }) };
}

/** Run the full import. Returns { status: 'written'|'unchanged', dir, manifest }. Throws SnapshotError on refusal. */
export async function runSnapshot(options) {
  const { input, outDir, previous, replace = false, allowLargeChange = false, allowNewTags = false, maxDropRate = 0.05, maxRejectRate = 0.001 } = options;
  if (!input || !outDir) throw new SnapshotError('--input and --out-dir are required.');
  const sourceName = options.sourceName || (input === '-' ? null : path.basename(input));
  const named = parseDumpName(sourceName);
  const asOf = options.asOf || named?.asOf;
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapshotError('Snapshot date unknown: use a STRUCTURES_FullDump_<YYYYMMDD>_<n> source name or --as-of YYYY-MM-DD.');

  const hash = createHash('sha256');
  const { stream, lines } = linesOf(input);
  stream.on('data', (chunk) => hash.update(chunk));
  const { rows, report } = await buildSnapshot(lines, { maxRejectRate, allowNewTags });
  const sourceSha256 = hash.digest('hex');
  if (named && options.asOf === undefined && report.records !== named.expectedRecords) {
    throw new SnapshotError(`File name promises ${named.expectedRecords} records but the dump holds ${report.records} (incomplete upload?).`);
  }

  let diff = null;
  if (previous) {
    diff = diffSnapshots(rows, await readPrevious(linesOf(previous).lines));
    if (diff.removedRate > maxDropRate && !allowLargeChange) {
      throw new SnapshotError(`${diff.removed} of ${diff.previousCompounds} previous compounds are missing (${(diff.removedRate * 100).toFixed(2)}% > ${(maxDropRate * 100).toFixed(2)}%). Review, then rerun with --allow-large-change.`, { diff });
    }
  }

  const csv = snapshotCsv(rows);
  const manifest = {
    format: SNAPSHOT_FORMAT, asOf, source: { name: sourceName, sha256: sourceSha256 },
    snapshotSha256: createHash('sha256').update(csv).digest('hex'),
    minOfferMg: MIN_OFFER_MG, ...report, diff,
  };
  const dir = path.join(outDir, asOf);
  const existing = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8').then(JSON.parse, () => null);
  if (existing) {
    if (existing.source?.sha256 === sourceSha256 && existing.snapshotSha256 === manifest.snapshotSha256) {
      return { status: 'unchanged', dir, manifest: existing };
    }
    if (!replace) throw new SnapshotError(`A different snapshot for ${asOf} already exists in ${dir}. Rerun with --replace after review.`);
  }
  await fs.mkdir(outDir, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(outDir, `.${asOf}.tmp-`));
  try {
    await fs.writeFile(path.join(tmp, 'availability.csv'), csv);
    await fs.writeFile(path.join(tmp, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    if (existing) await fs.rm(dir, { recursive: true });
    await fs.rename(tmp, dir);
  } catch (error) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw error;
  }
  return { status: 'written', dir, manifest };
}

function parseArgs(argv) {
  const flags = { replace: false, allowLargeChange: false, allowNewTags: false };
  const valued = { '--input': 'input', '--out-dir': 'outDir', '--source-name': 'sourceName', '--as-of': 'asOf', '--previous': 'previous', '--max-drop-rate': 'maxDropRate', '--max-reject-rate': 'maxRejectRate' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--replace') flags.replace = true;
    else if (arg === '--allow-large-change') flags.allowLargeChange = true;
    else if (arg === '--allow-new-tags') flags.allowNewTags = true;
    else if (valued[arg] && i + 1 < argv.length) flags[valued[arg]] = argv[++i];
    else throw new SnapshotError(`Unknown or incomplete argument: ${arg}`);
  }
  for (const key of ['maxDropRate', 'maxRejectRate']) {
    if (flags[key] !== undefined) {
      const n = Number(flags[key]);
      if (!(n >= 0 && n <= 1)) throw new SnapshotError(`--${key} must be between 0 and 1.`);
      flags[key] = n;
    }
  }
  return flags;
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); return 2; }
  try {
    const { status, dir, manifest } = await runSnapshot(options);
    const { records, compounds, offerableCompounds, rejects, diff } = manifest;
    console.log(`${status === 'unchanged' ? 'Unchanged (same source already imported)' : 'Snapshot written'}: ${dir}`);
    console.log(`  vial records ${records}, rejected ${rejects.total}, compounds ${compounds}, offerable ≥${MIN_OFFER_MG} mg ${offerableCompounds}`);
    if (diff) console.log(`  vs previous: +${diff.added} −${diff.removed} lost-offer ${diff.lostOffer} gained-offer ${diff.gainedOffer}`);
    return 0;
  } catch (error) {
    if (error instanceof SnapshotError) {
      console.error(`Refused: ${error.message}`);
      if (Object.keys(error.details).length) console.error(JSON.stringify(error.details, null, 2).slice(0, 4000));
      return 1;
    }
    console.error(error);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main();
