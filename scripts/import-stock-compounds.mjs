#!/usr/bin/env node
/**
 * Import Anna's stock-compound dataset (MOE export) into a tonomitosql search service.
 *
 * WHY THIS EXISTS
 * ---------------
 * CompChem supplied a MOE export of stock compounds for similarity search:
 *   https://spectra.pyxis-discovery.com/CompChem/STRUCTURES_20260901_63652_unique.zip
 * (~695 MB zip → 3.16 GB TSV). The Pyxis similarity search (client deep-similarity.jsx)
 * is backed by tonomitosql (repo kobimic887/tonomitosql), currently live on oracleOld
 * :8000 and destined for the Amsterdam box. tonomitosql ingests CSV with a `smiles`
 * column; every other column becomes JSONB metadata; ALL SIX search fingerprints
 * (morgan/maccs/feat_morgan/atom_pair/torsion/rdkit) are computed inside Postgres by
 * the RDKit cartridge — the same implementation and settings for library AND query
 * molecules. That is why this import feeds STRUCTURES (the `mol` SMILES column), not
 * MOE fingerprints: MOE FP:* columns are never compared against RDKit query
 * fingerprints (FP:MACCS sparse key lists are NOT RDKit MACCS bit vectors).
 *
 * Source-file fidelity: the original TSV (with every MOE fingerprint column) is the
 * preservation artifact — keep it and its sha256 (recorded in the manifest). The DB
 * carries original SMILES (molecules.smiles), engine canonical SMILES, and original
 * compound IDs + stock amounts as metadata under their ORIGINAL column names.
 *
 * ARCHITECTURE / SAFETY
 * ---------------------
 * - Idempotent by name: if a dataset named --name already exists, the script ABORTS
 *   unless --replace (delete + re-import) or --expect-existing (verify counts, no-op).
 *   Re-running never silently duplicates compounds.
 * - Duplicate compound IDs within the source: first occurrence wins, later rows are
 *   rejected and reported. Duplicate structures under DIFFERENT IDs are kept (distinct
 *   stock entries) but counted in the report.
 * - arm64 caveat (oracleOld is Ampere): tonomitosql's API container has no rdkit-pypi
 *   there, so /v1/upload cannot itemize bad SMILES — invalid rows are silently dropped
 *   between staging and molecules. This script detects that (valid + invalid < accepted)
 *   and identifies the offenders by bisect upload into a temporary dataset, so the
 *   rejected-records report is complete on both architectures.
 * - Everything large (TSV, generated CSV, reports, manifest) lives in --out-dir,
 *   OUTSIDE the repo. Only this script and docs/DATA-STOCK-COMPOUNDS.md are tracked.
 *
 * USAGE
 * -----
 *   bun scripts/import-stock-compounds.mjs \
 *     --input ~/projects/medsaas-data/stock-20260901/STRUCTURES_20260901_63652_unique.txt \
 *     --base-url http://localhost:8000 \
 *     [--name "Stock compounds — 2026-09-01"] [--out-dir <dir>] [--limit N] [--dry-run]
 *     [--replace | --expect-existing] [--verify] [--dataset-id N]
 *
 * Flags:
 *   --input <path>        extracted .txt TSV (or the .zip — it is streamed via `unzip -p`)
 *   --base-url <url>      tonomitosql base URL, e.g. http://151.145.91.17:8000 (live) or
 *                         http://151.145.91.17:8010 (isolated scratch stack). No secrets —
 *                         the service has no auth; NEVER point this at production data
 *                         without explicit approval.
 *   --name <s>            dataset name. Default "Stock compounds — 2026-09-01".
 *   --out-dir <dir>       where the generated CSV / report / manifest go. Default: dir of --input.
 *   --limit <n>           only import the first n valid rows (smoke tests).
 *   --dry-run             parse + validate + write CSV + report; no service calls.
 *   --replace             if the dataset name already exists: DELETE it, then re-import.
 *   --expect-existing     if the dataset name already exists: verify row_count matches
 *                         the source and exit 0 (idempotent no-op). No new dataset.
 *   --verify              after import (or with --dataset-id alone): self-search checks —
 *                         see verify() below.
 *   --dataset-id <n>      verify an already-imported dataset without re-importing.
 *   --max-reject-rate <f> abort (exit 1) if rejected/total exceeds this. Default 0.02.
 *
 * Exit codes: 0 success (or verified no-op) · 1 validation/verification failure ·
 * 2 service error. Reports: import-report.json (+ .md summary) in --out-dir.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_NAME = 'Stock compounds — 2026-09-01';
const EXPECTED_COLUMNS = [
  'mol', 'MAIN_BAS', 'ID', 'CURRENT_TOT_AMOUNT_UM', 'CURRENT_TOT_NETTO_MG',
  'FP:MACCS', 'FP:GpiDAPH3', 'FP:piDAPH3', 'FP:ECFP4_2048', 'FP:ECFP4',
  'FP:FCFP4', 'FP:FCFP4_2048', 'FP:ECFP6', 'FP:ECFP6_2048', 'FP:FCFP6', 'FP:FCFP6_2048',
];
// CSV header for tonomitosql: `smiles` is required by the engine (dedicated column);
// every other column becomes JSONB metadata. ID/MAIN_BAS/amounts keep their ORIGINAL
// source names (verbatim values, incl. leading zeros). `compound_id` duplicates
// MAIN_BAS because deep-similarity.jsx result cards render exactly
// compound_id/molecular_formula/monoisotopic_mass/activity_score — without it, stock
// hits would show no recognizable compound identifier (see docs/DATA-STOCK-COMPOUNDS.md).
const CSV_HEADER = ['smiles', 'ID', 'MAIN_BAS', 'compound_id', 'CURRENT_TOT_AMOUNT_UM', 'CURRENT_TOT_NETTO_MG'];
const FP_COLUMN_PREFIX = 'FP:'; // MOE fingerprint columns — preserved in source file, NOT imported
const DIAGNOSTIC_DATASET_NAME = 'stock-import-diagnostic (safe to delete)';
const BISECT_CHUNK = 512;
const MAX_BISECT_IDENTIFIED = 500;
// 630k molecules × 6 cartridge fingerprints on an arm64 Ampere box can take a
// while — the /v1/upload POST stays open until fingerprints are computed. Measured
// 2026-09-05 on oracleOld: ~12.5h upload→commit (single cartridge core). Both 60 min
// and 3h client timeouts were cut off mid-fingerprint; the server-side transaction
// still committed, and the run was recovered with --dataset-id + --verify. 24h
// leaves margin for one clean run.
const UPLOAD_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {
    name: DEFAULT_NAME, limit: Number.POSITIVE_INFINITY, dryRun: false,
    replace: false, expectExisting: false, verify: false, maxRejectRate: 0.02,
  };
  const positional = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : undefined);
    switch (a) {
      case '--input': positional.input = next(); break;
      case '--base-url': positional.baseUrl = next(); break;
      case '--name': flags.name = next(); break;
      case '--out-dir': positional.outDir = next(); break;
      case '--limit': flags.limit = Number(next()); break;
      case '--dry-run': flags.dryRun = true; break;
      case '--replace': flags.replace = true; break;
      case '--expect-existing': flags.expectExisting = true; break;
      case '--verify': flags.verify = true; break;
      case '--dataset-id': positional.datasetId = Number(next()); break;
      case '--max-reject-rate': flags.maxRejectRate = Number(next()); break;
      case '--help': case '-h': positional.help = true; break;
      default: throw new Error(`Unknown argument: ${a}`);
    }
  }
  return { flags, positional };
}

function requireFlags({ flags, positional }) {
  if (!positional.input) throw new Error('--input is required (extracted .txt or the .zip)');
  if (!flags.dryRun && !positional.baseUrl) {
    throw new Error('--base-url is required unless --dry-run');
  }
  if (flags.replace && flags.expectExisting) {
    throw new Error('--replace and --expect-existing are mutually exclusive');
  }
  if (flags.verify && flags.dryRun) {
    throw new Error('--verify needs a live service — drop --dry-run');
  }
}

// ── Small utilities ──────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await streamInto(filePath, hash);
  return hash.digest('hex');
}

function streamInto(filePath, target) {
  return new Promise((resolve, reject) => {
    if (typeof target.setEncoding === 'function') target.setEncoding('binary');
    createReadStream(filePath, { encoding: 'binary' })
      .on('data', (c) => target.update(c))
      .on('error', reject)
      .on('end', resolve);
  });
}

function csvEscape(value) {
  const v = String(value ?? '');
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ── Source parsing: MOE TSV → validated rows + rejects ───────────────────────

/**
 * Streams the MOE TSV once. Emits:
 *  - rows: [{ lineNo, ID, MAIN_BAS, smiles, amounts… }] (accepted, in file order)
 *  - rejects: [{ lineNo, ID, reason, preview }]
 *  - stats: counts, duplicate-structure count, column anomalies
 * Rows are rejected for: wrong field count, empty mol, empty ID, duplicate ID.
 * Different IDs sharing an identical SMILES are KEPT (distinct stock entries) but counted.
 */
async function parseSource(inputPath, { limit }) {
  const stats = {
    sourceFile: inputPath,
    startedAt: nowIso(),
    totalLines: 0,
    dataRows: 0,
    accepted: 0,
    rejected: 0,
    duplicateIdRows: 0,
    duplicateStructureRows: 0,
    fieldCountAnomalies: 0,
    rejectReasons: {},
  };
  const rejects = [];
  const rows = [];
  const seenIds = new Map(); // ID -> first lineNo
  const seenSmiles = new Set();

  const lineStream = inputPath.endsWith('.zip')
    ? unzipStream(inputPath)
    : createReadStream(inputPath, { encoding: 'utf8' });
  // `break`ing the for-await below only closes the readline interface; on an
  // early --limit stop, also destroy the underlying stream so we do not hold a
  // 3 GB fd open (and so `unzip -p` gets SIGPIPE instead of streaming forever).
  const closeStream = () => { try { lineStream.destroy?.(); } catch { /* already closed */ } };

  const rl = readline.createInterface({ input: lineStream, crlfDelay: Infinity });

  const reject = (lineNo, ID, reason, preview) => {
    stats.rejected++;
    stats.rejectReasons[reason] = (stats.rejectReasons[reason] || 0) + 1;
    rejects.push({ lineNo, ID: ID ?? null, reason, preview: (preview ?? '').slice(0, 160) });
  };

  let header = null;
  for await (const raw of rl) {
    stats.totalLines++;
    const line = raw;
    if (header === null) {
      header = line.split('\t');
      const headerOk = EXPECTED_COLUMNS.length === header.length
        && EXPECTED_COLUMNS.every((c, i) => c === header[i]);
      stats.header = header;
      stats.headerMatchesExpectation = headerOk;
      if (!headerOk) {
        throw new Error(
          `Unexpected header.\n  expected: ${EXPECTED_COLUMNS.join(',')}\n  actual:   ${header.join(',')}\n`
          + 'Refusing to guess column positions — update EXPECTED_COLUMNS after re-inspecting the source.');
      }
      continue;
    }
    if (line.trim() === '') { stats.totalLines--; continue; } // trailing newline
    stats.dataRows++;

    const fields = line.split('\t');
    if (fields.length !== header.length) {
      stats.fieldCountAnomalies++;
      reject(stats.totalLines, null, `field count ${fields.length} != ${header.length}`, line);
      continue;
    }
    const mol = fields[0].trim();
    const mainBas = fields[1].trim();
    const id = fields[2].trim();
    const amountUm = fields[3].trim();
    const amountMg = fields[4].trim();

    if (mol === '') { reject(stats.totalLines, id, 'empty mol (SMILES) field', line); continue; }
    if (id === '') { reject(stats.totalLines, null, 'empty ID field', line); continue; }
    if (seenIds.has(id)) {
      stats.duplicateIdRows++;
      reject(stats.totalLines, id, `duplicate ID (first seen line ${seenIds.get(id)})`, mainBas);
      continue;
    }
    seenIds.set(id, stats.totalLines);
    if (seenSmiles.has(mol)) stats.duplicateStructureRows++;
    else seenSmiles.add(mol);

    rows.push({
      lineNo: stats.totalLines, smiles: mol, ID: id, MAIN_BAS: mainBas,
      CURRENT_TOT_AMOUNT_UM: amountUm, CURRENT_TOT_NETTO_MG: amountMg,
    });
    stats.accepted++;
    if (rows.length >= limit) break;
  }
  rl.close();
  closeStream();
  stats.finishedAt = nowIso();
  stats.limitApplied = Number.isFinite(limit) ? limit : null;
  return { rows, rejects, stats };
}

function unzipStream(zipPath) {
  // `unzip -p` writes the single member to stdout; name checked by caller elsewhere.
  const child = spawn('unzip', ['-p', zipPath], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.on('error', (e) => { throw new Error(`unzip failed: ${e.message}`); });
  return child.stdout;
}

function writeUploadCsv(outDir, rows) {
  const csvPath = path.join(outDir, 'stock-compounds-upload.csv');
  const ws = createWriteStream(csvPath, { encoding: 'utf8' });
  ws.write(CSV_HEADER.join(',') + '\n');
  for (const r of rows) {
    ws.write([
      r.smiles, r.ID, r.MAIN_BAS, r.MAIN_BAS, r.CURRENT_TOT_AMOUNT_UM, r.CURRENT_TOT_NETTO_MG,
    ].map(csvEscape).join(',') + '\n');
  }
  return new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.end(() => resolve(csvPath));
  });
}

// ── tonomitosql client (no auth — service is internal; see header warning) ──

function makeClient(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  const json = async (res, what) => {
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok) {
      const err = new Error(`${what} → HTTP ${res.status}: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return body;
  };
  return {
    health: () => fetch(`${base}/health`).then((r) => json(r, 'GET /health')),
    datasets: () => fetch(`${base}/v1/datasets`).then((r) => json(r, 'GET /v1/datasets')),
    dataset: (id) => fetch(`${base}/v1/datasets/${id}`).then((r) => json(r, `GET /v1/datasets/${id}`)),
    deleteDataset: (id) => fetch(`${base}/v1/datasets/${id}`, { method: 'DELETE' }).then((r) => json(r, `DELETE /v1/datasets/${id}`)),
    async upload(csvPath, datasetName) {
      // Large uploads (630k rows ≈ 70 MB) keep the POST open for many minutes
      // while the engine parses, inserts, and fingerprints — Node's fetch
      // (undici) aborts such long-lived requests, so upload via spawned curl
      // instead (same pattern as unzipStream). NOTE: the engine declares
      // `dataset_name` WITHOUT Form(), so FastAPI reads it from the QUERY
      // STRING — a multipart field is silently ignored (falls back to filename).
      const url = `${base}/v1/upload?dataset_name=${encodeURIComponent(datasetName)}`;
      const args = [
        '--silent', '--show-error', '--fail-with-body',
        '--max-time', String(Math.floor(UPLOAD_TIMEOUT_MS / 1000)),
        '-F', `file=@${csvPath};type=text/csv`,
        url,
      ];
      const out = await new Promise((resolve, reject) => {
        const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', (c) => { stdout += c; });
        child.stderr.on('data', (c) => { stderr += c; });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) return resolve(stdout);
          reject(new Error(`POST /v1/upload failed (curl exit ${code}): ${(stderr || stdout).slice(0, 300)}`));
        });
      });
      let body; try { body = JSON.parse(out); } catch { body = out; }
      if (typeof body !== 'object' || body === null) {
        throw new Error(`POST /v1/upload → non-JSON response: ${String(body).slice(0, 300)}`);
      }
      return body;
    },
    similarity: (params) => {
      const q = new URLSearchParams(params);
      return fetch(`${base}/v1/search/similarity?${q}`).then((r) => json(r, 'GET /v1/search/similarity'));
    },
    exact: (params) => {
      const q = new URLSearchParams(params);
      return fetch(`${base}/v1/search/exact?${q}`).then((r) => json(r, 'GET /v1/search/exact'));
    },
  };
}

// ── Idempotency guard ────────────────────────────────────────────────────────

async function resolveExistingDataset(client, name, { replace, expectExisting }) {
  const { datasets } = await client.datasets();
  const existing = datasets.find((d) => d.name === name) || null;
  if (!existing) return { action: 'create' };
  if (expectExisting) return { action: 'verify-existing', existing };
  if (replace) return { action: 'replace', existing };
  return {
    action: 'abort',
    existing,
    message: `Dataset "${name}" already exists (id=${existing.id}, row_count=${existing.row_count}). `
      + 'Re-running must not silently duplicate: pass --replace to delete + re-import, '
      + 'or --expect-existing to verify counts and no-op.',
  };
}

// ── Upload + arm64 silent-drop bisect ────────────────────────────────────────

async function uploadAndReconcile(client, csvPath, name, rows, report) {
  const upload = await client.upload(csvPath, name);
  const datasetId = upload.dataset_id;
  const accounted = upload.valid_count + upload.invalid_count;
  const silentDrops = rows.length - accounted;

  report.upload = {
    dataset_id: datasetId, filename: upload.filename,
    engine_total_rows: upload.total_rows, engine_valid: upload.valid_count,
    engine_invalid: upload.invalid_count,
    engine_error_rows_listed: Array.isArray(upload.errors) ? upload.errors.length : 0,
    silent_drops: Math.max(0, silentDrops),
  };
  if (upload.total_rows !== rows.length) {
    throw new Error(`Engine counted ${upload.total_rows} CSV rows but we submitted ${rows.length} — CSV serialization mismatch. Aborting before more damage.`);
  }
  for (const e of upload.errors || []) {
    report.engineRejects.push({ engine_row: e.row, smiles: (e.smiles || '').slice(0, 200), reason: e.reason });
  }

  if (silentDrops > 0) {
    console.warn(`⚠ ${silentDrops} row(s) accepted by CSV parse but dropped silently by the engine `
      + '(arm64: no rdkit-pypi in the API container, so no row-level errors). Bisecting to identify them…');
    const identified = await bisectSilentDrops(client, rows, report);
    report.upload.silent_drops_identified = identified.length;
    report.silentDropRows = identified.slice(0, MAX_BISECT_IDENTIFIED);
  }
  return upload;
}

/**
 * On arm64 the engine drops unparseable SMILES without listing them. Upload chunks
 * of the accepted rows to a throwaway dataset; any chunk whose counts come up short
 * is split recursively until individual offenders are isolated. The diagnostic
 * dataset is deleted afterwards regardless of outcome.
 */
async function bisectSilentDrops(client, rows, report) {
  const offenders = [];
  let diagnosticId = null;
  try {
    // Per-chunk accounting needs its own dataset (row counts are per dataset), so each
    // chunk/bisect half is uploaded as its own throwaway dataset and deleted right
    // after the count check.
    const reconcileChunk = async (chunk, depth) => {
      if (offenders.length >= MAX_BISECT_IDENTIFIED) return;
      if (chunk.length === 1) {
        offenders.push({
          lineNo: chunk[0].lineNo, ID: chunk[0].ID, smiles: chunk[0].smiles.slice(0, 200),
          reason: 'rejected by RDKit cartridge (mol_from_smiles returned NULL) — isolated by bisect upload',
        });
        return;
      }
      const p = path.join(report.outDir, `.bisect-${depth}-${chunk[0].lineNo}.csv`);
      const ws = createWriteStream(p, { encoding: 'utf8' });
      ws.write(CSV_HEADER.join(',') + '\n');
      for (const r of chunk) {
        ws.write([r.smiles, r.ID, r.MAIN_BAS, r.MAIN_BAS, r.CURRENT_TOT_AMOUNT_UM, r.CURRENT_TOT_NETTO_MG].map(csvEscape).join(',') + '\n');
      }
      await new Promise((res, rej) => { ws.on('error', rej); ws.end(res); });
      const up = await client.upload(p, `${DIAGNOSTIC_DATASET_NAME} #${depth}-${chunk[0].lineNo}`);
      const dropped = chunk.length - up.valid_count - up.invalid_count;
      await client.deleteDataset(up.dataset_id).catch(() => {});
      await fs.rm(p, { force: true });
      if (dropped === 0) return;
      const mid = Math.ceil(chunk.length / 2);
      await reconcileChunk(chunk.slice(0, mid), depth + 1);
      await reconcileChunk(chunk.slice(mid), depth + 1);
    };
    for (let i = 0; i < rows.length && offenders.length < MAX_BISECT_IDENTIFIED; i += BISECT_CHUNK) {
      await reconcileChunk(rows.slice(i, i + BISECT_CHUNK), 0);
    }
    return offenders;
  } finally {
    if (diagnosticId !== null) await client.deleteDataset(diagnosticId).catch(() => {});
    // sweep any stray diagnostic datasets from aborted runs
    try {
      const { datasets } = await client.datasets();
      for (const d of datasets) {
        if (d.name.startsWith('stock-import-diagnostic')) await client.deleteDataset(d.id).catch(() => {});
      }
    } catch { /* best effort */ }
  }
}

// ── Post-import verification ─────────────────────────────────────────────────

const FP_TYPES = ['morgan', 'maccs', 'feat_morgan', 'atom_pair', 'torsion', 'rdkit'];

/**
 * Real-record checks against the imported dataset:
 *  1. datasets list shows our name with row_count == engine valid count
 *  2. self-search: for a deterministic sample of source rows, similarity search at
 *     threshold 1.0 under EVERY fingerprint type must return the compound itself
 *     (similarity 1.0) with metadata.ID preserved; exact-search must find it too
 *  3. ranked search: a sample compound at threshold 0.3 must return multiple hits,
 *     sorted by similarity desc, all >= threshold, self at the top
 */
async function verifyDataset(client, datasetId, rows, report) {
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ check: name, ok, detail });
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const ds = await client.dataset(datasetId);
  check('dataset reachable', true, `id=${ds.id} name="${ds.name}" row_count=${ds.row_count}`);

  const sample = pickSample(rows);
  for (const row of sample) {
    for (const fp of FP_TYPES) {
      try {
        const r = await client.similarity({
          smiles: row.smiles, threshold: '1.0', dataset_id: datasetId,
          fingerprint_type: fp, similarity_metric: 'tanimoto', limit: '50',
        });
        const selfHits = (r.results || []).filter((m) => (m.metadata?.ID ?? null) === row.ID);
        const ok = selfHits.length > 0 && selfHits.every((m) => m.similarity === 1);
        check(`self-search ${fp} @1.0 [ID ${row.ID}]`, ok,
          ok ? `${selfHits.length} hit(s), similarity 1.0, source ID preserved`
            : `hits=${r.count} matchingID=${selfHits.length}`);
      } catch (e) {
        check(`self-search ${fp} @1.0 [ID ${row.ID}]`, false, e.message);
      }
    }
    try {
      const e = await client.exact({ smiles: row.smiles, dataset_id: datasetId });
      const ok = e.found && (e.results || []).some((m) => m.metadata?.ID === row.ID);
      check(`exact match [ID ${row.ID}]`, ok, ok ? 'found with source ID' : 'not found by exact search');
    } catch (err) {
      check(`exact match [ID ${row.ID}]`, false, err.message);
    }
  }

  const probe = sample[0];
  try {
    const r = await client.similarity({
      smiles: probe.smiles, threshold: '0.3', dataset_id: datasetId,
      fingerprint_type: 'morgan', similarity_metric: 'tanimoto', limit: '50',
    });
    const sims = (r.results || []).map((m) => m.similarity);
    const sortedDesc = sims.every((s, i) => i === 0 || sims[i - 1] >= s);
    const selfTop = r.results?.[0]?.metadata?.ID === probe.ID && r.results[0].similarity === 1;
    // count==1 (just the self) is expected on small smoke subsets when no molecule
    // is within 0.3 of the probe; ranked order is still verified whenever neighbors exist.
    const ok = r.count >= 1 && sortedDesc && sims.every((s) => s >= 0.3) && selfTop;
    const detail = r.count > 1
      ? `count=${r.count} top=${sims[0]?.toFixed(3)} sortedDesc=${sortedDesc} selfAtTop=${selfTop}`
      : `count=1 (no neighbors ≥0.3 in this dataset) selfAtTop=${selfTop}`;
    check('ranked similarity (morgan @0.3)', ok, detail);
  } catch (e) {
    check('ranked similarity (morgan @0.3)', false, e.message);
  }

  const failed = results.filter((r) => !r.ok);
  report.verification = { checks: results, passed: results.length - failed.length, failed: failed.length };
  return failed.length === 0;
}

function pickSample(rows) {
  if (rows.length <= 7) return rows;
  const mid = Math.floor(rows.length / 2);
  return [
    rows[0], rows[1], rows[mid - 1], rows[mid], rows[mid + 1],
    rows[rows.length - 2], rows[rows.length - 1],
  ];
}

// ── Report / manifest ────────────────────────────────────────────────────────

async function writeReport(outDir, report) {
  const jsonPath = path.join(outDir, 'import-report.json');
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

  const md = [
    `# Stock compounds import report — ${report.name}`,
    '',
    `- Generated: ${report.generatedAt}`,
    `- Source: ${report.source.inputFile}`,
    `- Source sha256 (zip): ${report.source.zipSha256 ?? 'n/a'}`,
    `- Source sha256 (txt): ${report.source.txtSha256 ?? 'n/a'}`,
    `- Data rows in source: ${report.parse.dataRows}`,
    `- Accepted: ${report.parse.accepted}`,
    `- Rejected (source validation): ${report.parse.rejected}`,
    `  - by reason: ${JSON.stringify(report.parse.rejectReasons)}`,
    `- Duplicate structures under different IDs (kept): ${report.parse.duplicateStructureRows}`,
    report.upload ? [
      `- Dataset id: ${report.upload.dataset_id}`,
      `- Engine: total=${report.upload.engine_total_rows} valid=${report.upload.engine_valid} invalid=${report.upload.engine_invalid}`,
      `- Silent drops: ${report.upload.silent_drops} (identified: ${report.upload.silent_drops_identified ?? 0})`,
    ].join('\n') : '- No upload (dry run)',
    report.verification ? [
      `- Verification: ${report.verification.passed} passed, ${report.verification.failed} failed`,
    ].join('\n') : '',
    '',
    report.rejects.length
      ? `## Rejected records (${report.rejects.length} shown of ${report.parse.rejected})\n\n`
        + '| line | ID | reason |\n|---|---|---|\n'
        + report.rejects.slice(0, 200).map((r) => `| ${r.lineNo} | ${r.ID ?? ''} | ${r.reason} |`).join('\n')
      : '## Rejected records\n\nnone',
    '',
  ].join('\n');
  const mdPath = path.join(outDir, 'import-report.md');
  await fs.writeFile(mdPath, md);
  return { jsonPath, mdPath };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (positional.help) { console.log('See header comment of this file for usage.'); return 0; }
  requireFlags({ flags, positional });

  const inputPath = path.resolve(positional.input.replace('~', process.env.HOME));
  const outDir = path.resolve((positional.outDir || path.dirname(inputPath)).replace('~', process.env.HOME));
  await fs.mkdir(outDir, { recursive: true });

  const report = {
    name: flags.name, generatedAt: nowIso(),
    source: { inputFile: inputPath, zipSha256: null, txtSha256: null },
    parse: null, upload: null, engineRejects: [], silentDropRows: [],
    rejects: [], verification: null, outDir,
  };

  // 1. Parse + source validation
  console.log(`▶ Parsing ${inputPath} …`);
  const { rows, rejects, stats } = await parseSource(inputPath, { limit: flags.limit });
  report.parse = stats;
  report.rejects = rejects;
  console.log(`  dataRows=${stats.dataRows} accepted=${stats.accepted} rejected=${stats.rejected} `
    + `dupID=${stats.duplicateIdRows} dupStructure(kept)=${stats.duplicateStructureRows}`);

  // 2. Write upload CSV
  const csvPath = await writeUploadCsv(outDir, rows);
  report.uploadCsv = csvPath;
  console.log(`▶ Upload CSV written: ${csvPath} (${rows.length} rows)`);

  // 3. Source checksums (async, off the critical path — awaited before finishing)
  const txtPath = inputPath.endsWith('.zip') ? null : inputPath;
  const shaPromise = Promise.allSettled([
    txtPath ? sha256File(txtPath) : Promise.resolve(null),
    inputPath.endsWith('.zip') ? sha256File(inputPath) : Promise.resolve(null),
  ]);

  // 4. Idempotency + upload (--dataset-id implies verify-only: no name guard, no upload)
  let datasetId = positional.datasetId ?? null;
  const verifyOnly = Boolean(positional.datasetId);
  let client = null;
  let verifyRows = rows;

  if (!flags.dryRun) client = makeClient(positional.baseUrl);

  if (!flags.dryRun && !verifyOnly) {
    const health = await client.health();
    console.log(`▶ Service healthy: ${health.status} rdkit=${health.rdkit_version} molecules=${health.molecule_count}`);

    const guard = await resolveExistingDataset(client, flags.name, flags);
    if (guard.action === 'abort') {
      console.error(`✋ ${guard.message}`);
      await finish(report, shaPromise, 1);
    }
    if (guard.action === 'verify-existing') {
      const ok = guard.existing.row_count === stats.accepted;
      console.log(`${ok ? '✓' : '✗'} --expect-existing: dataset row_count=${guard.existing.row_count}, source accepted=${stats.accepted}`);
      datasetId = guard.existing.id;
      if (!ok) {
        console.error('  Counts differ — dataset is stale. Re-run with --replace to rebuild it.');
        await finish(report, shaPromise, 1);
      }
    }
    if (guard.action === 'replace') {
      console.log(`▶ --replace: deleting dataset id=${guard.existing.id} ("${guard.existing.name}", ${guard.existing.row_count} rows)`);
      await client.deleteDataset(guard.existing.id);
    }
    if (guard.action !== 'verify-existing') {
      console.log(`▶ Uploading ${rows.length} rows as "${flags.name}" …`);
      const upload = await uploadAndReconcile(client, csvPath, flags.name, rows, report);
      datasetId = upload.dataset_id;
      console.log(`  dataset_id=${datasetId} valid=${upload.valid_count} invalid=${upload.invalid_count} silentDrops=${report.upload.silent_drops}`);
    }
  }

  // 5. Reject-rate gate
  if (stats.dataRows > 0) {
    const rate = stats.rejected / stats.dataRows;
    if (rate > flags.maxRejectRate) {
      console.error(`✋ Reject rate ${(rate * 100).toFixed(3)}% exceeds --max-reject-rate ${(flags.maxRejectRate * 100).toFixed(1)}%. See import-report.json.`);
      await finish(report, shaPromise, 2);
    }
  }

  // 6. Verification
  if (flags.verify && datasetId && client) {
    console.log(`▶ Verifying dataset ${datasetId} with ${verifyRows.length} known rows …`);
    // For --expect-existing / --dataset-id runs we still hold the freshly parsed rows.
    const ok = await verifyDataset(client, datasetId, verifyRows, report);
    if (!ok) { console.error('✋ Verification failed — see import-report.json'); await finish(report, shaPromise, 1); }
    console.log(`  verification: ${report.verification.passed} passed / ${report.verification.failed} failed`);
  } else if (flags.verify && !datasetId) {
    console.error('✋ --verify needs a dataset (--dataset-id or a completed import)');
    await finish(report, shaPromise, 1);
  }

  const [txtSha, zipSha] = await shaPromise;
  report.source.txtSha256 = txtSha.status === 'fulfilled' ? txtSha.value : null;
  report.source.zipSha256 = zipSha.status === 'fulfilled' ? zipSha.value : null;

  const { jsonPath, mdPath } = await writeReport(outDir, report);
  console.log(`✅ Done. Report: ${mdPath} / ${jsonPath}`);
  return 0;
}

async function finish(report, shaPromise, code) {
  const [txtSha, zipSha] = await shaPromise;
  report.source.txtSha256 = txtSha.status === 'fulfilled' ? txtSha.value : null;
  report.source.zipSha256 = zipSha.status === 'fulfilled' ? zipSha.value : null;
  const { jsonPath } = await writeReport(report.outDir, report);
  console.error(`Report written: ${jsonPath}`);
  process.exit(code);
}

main().catch((e) => { console.error(`✋ ${e.message}`); process.exit(2); });
