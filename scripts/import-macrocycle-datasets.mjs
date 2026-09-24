#!/usr/bin/env node
/**
 * Validate and normalize Anna's 2026-09-23 macrocycle exports.
 *
 * The dated source files are immutable evidence; use --input to point to a
 * downloaded original outside the repo. Writes a normalized CSV plus
 * checksums/report without touching any service:
 *
 * bun scripts/import-macrocycle-datasets.mjs --source real \
 *   --input /data/Pyxis_RealStock_18190.csv --out-dir /data/macro-real
 * bun scripts/import-macrocycle-datasets.mjs --source virtual \
 *   --input /data/Pyxis_Virtual_Molecules_20260923.zip --out-dir /data/macro-virtual
 *
 * The full virtual set cannot safely fit on the existing 151 tonomitosql host;
 * this tool deliberately has no upload flag. --limit names a sample so smoke
 * output cannot masquerade as the full set.
 * No source has prices. web_mg and CURRENT_TOT_NETTO_MG are amounts, not packs.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { MACROCYCLE_DATASETS, parseMacrocycleSource } from '../server/utils/macrocycleSearch.js';

const HEADERS = {
  real: ['mol', 'MAIN_BAS', 'web_mg', 'web_uM', 'Lead_TIME'],
  virtual: ['mol', 'ID', 'MAIN_BAS', 'CURRENT_TOT_NETTO_MG', 'CURRENT_TOT_AMOUNT_UM', 'Lead_TIME'],
};
const OUTPUT_HEADER = [
  'smiles', 'ID', 'MAIN_BAS', 'compound_id', 'source', 'source_file',
  'web_mg', 'web_uM', 'CURRENT_TOT_NETTO_MG', 'CURRENT_TOT_AMOUNT_UM', 'Lead_TIME',
];
const EXPECTED_ROWS = { real: 18190, virtual: 2350440 };

function argsFrom(argv) {
  const opts = { limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--source') opts.source = argv[++i];
    else if (key === '--input') opts.input = argv[++i];
    else if (key === '--out-dir') opts.outDir = argv[++i];
    else if (key === '--limit') opts.limit = Number(argv[++i]);
    else if (key === '--dry-run') { /* accepted for compatibility; all runs are non-mutating */ }
    else if (key === '--help' || key === '-h') opts.help = true;
    else throw new Error(`Unknown option: ${key}`);
  }
  if (opts.help) return opts;
  opts.source = parseMacrocycleSource(opts.source);
  if (!opts.input || !opts.outDir) throw new Error('--input and --out-dir are required');
  if (!Number.isInteger(opts.limit) && opts.limit !== Infinity || opts.limit < 1) throw new Error('--limit must be a positive integer');
  return opts;
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { fields.push(current); current = ''; }
    else current += char;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field');
  fields.push(current);
  return fields;
}

function csv(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function readZip(input) {
  const child = spawn('unzip', ['-p', input], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`unzip failed (${code}): ${stderr.slice(0, 200)}`)));
  });
  return { stream: child.stdout, done };
}

async function sha256(input) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(input)) hash.update(chunk);
  return hash.digest('hex');
}

async function normalizeSource(opts, uploadCsv) {
  const streamInfo = opts.input.toLowerCase().endsWith('.zip')
    ? readZip(opts.input) : { stream: createReadStream(opts.input), done: Promise.resolve() };
  const output = createWriteStream(uploadCsv, { encoding: 'utf8' });
  output.write(OUTPUT_HEADER.join(',') + '\n');
  const rl = readline.createInterface({ input: streamInfo.stream, crlfDelay: Infinity });
  const seenIds = new Set();
  const report = {
    source: opts.source, sourceFile: path.basename(opts.input), sourceUrl: MACROCYCLE_DATASETS[opts.source].sourceUrl,
    expectedRows: EXPECTED_ROWS[opts.source], inputRows: 0, acceptedRows: 0, rejectedRows: 0,
    duplicateIds: 0, rejectedExamples: [], sample: [], header: null,
  };
  let lineNo = 0;
  try {
    for await (const line of rl) {
      lineNo++;
      if (lineNo === 1) {
        const header = parseCsvLine(line.replace(/^\uFEFF/, ''));
        report.header = header;
        if (header.join('\0') !== HEADERS[opts.source].join('\0')) {
          throw new Error(`Unexpected ${opts.source} source header: ${header.join(',')}`);
        }
        continue;
      }
      if (!line.trim()) continue;
      report.inputRows++;
      let fields;
      try { fields = parseCsvLine(line); }
      catch { fields = null; }
      const values = fields && fields.length === report.header.length
        ? Object.fromEntries(report.header.map((key, index) => [key, fields[index].trim()])) : null;
      // Real-stock source has no separate ID. MAIN_BAS is its supplier code,
      // and may repeat with a different amount/lead-time row; the index gives
      // each record a distinct row ID. Virtual rows keep their supplied ID.
      const id = opts.source === 'real' ? values?.MAIN_BAS : values?.ID;
      let reject = null;
      if (!values) reject = 'wrong CSV field count or malformed quoting';
      else if (!values.mol) reject = 'empty mol';
      else if (!values.MAIN_BAS) reject = 'empty MAIN_BAS';
      else if (!id) reject = 'empty ID';
      // The real-stock export repeats some supplier IDs with different
      // quantity/lead-time rows. Keep every source record; the search index
      // gives each row its own identity while the supplier code stays intact.
      else if (seenIds.has(id)) report.duplicateIds++;
      if (reject) {
        report.rejectedRows++;
        if (report.rejectedExamples.length < 100) report.rejectedExamples.push({ lineNo, id: id || null, reason: reject });
        continue;
      }
      seenIds.add(id);
      const row = {
        smiles: values.mol, ID: id, MAIN_BAS: values.MAIN_BAS,
        compound_id: values.MAIN_BAS, source: MACROCYCLE_DATASETS[opts.source].kind,
        source_file: MACROCYCLE_DATASETS[opts.source].sourceFile,
        web_mg: values.web_mg, web_uM: values.web_uM,
        CURRENT_TOT_NETTO_MG: values.CURRENT_TOT_NETTO_MG,
        CURRENT_TOT_AMOUNT_UM: values.CURRENT_TOT_AMOUNT_UM,
        Lead_TIME: values.Lead_TIME,
      };
      if (!output.write(OUTPUT_HEADER.map((key) => csv(row[key])).join(',') + '\n')) await once(output, 'drain');
      report.acceptedRows++;
      if (report.sample.length < 3) report.sample.push({ ID: id, MAIN_BAS: values.MAIN_BAS, smiles: values.mol });
      if (report.acceptedRows >= opts.limit) break;
    }
    if (opts.limit !== Infinity) {
      rl.close();
      streamInfo.stream.destroy();
      // Early stop deliberately closes unzip with SIGPIPE; do not await done.
      streamInfo.done.catch(() => {});
    } else await streamInfo.done;
  } finally {
    output.end();
    await once(output, 'finish');
  }
  return report;
}

async function main() {
  const opts = argsFrom(process.argv.slice(2));
  if (opts.help) { console.log('See script header for usage.'); return; }
  opts.input = path.resolve(opts.input);
  opts.outDir = path.resolve(opts.outDir);
  const stat = await fs.stat(opts.input);
  if (!stat.isFile()) throw new Error('--input must be a file');
  if (path.basename(opts.input) !== MACROCYCLE_DATASETS[opts.source].sourceFile) {
    throw new Error(`Expected source filename ${MACROCYCLE_DATASETS[opts.source].sourceFile}`);
  }
  await fs.mkdir(opts.outDir, { recursive: true });
  const name = opts.limit === Infinity ? MACROCYCLE_DATASETS[opts.source].name
    : `${MACROCYCLE_DATASETS[opts.source].name} — sample ${opts.limit}`;
  const uploadCsv = path.join(opts.outDir, `macrocycles-${opts.source}-upload.csv`);
  const sourceSha256 = await sha256(opts.input);
  const report = await normalizeSource(opts, uploadCsv);
  Object.assign(report, {
    generatedAt: new Date().toISOString(), datasetName: name, sourceSha256,
    uploadCsv, sourceBytes: stat.size, uploadCsvBytes: (await fs.stat(uploadCsv)).size,
    limit: Number.isFinite(opts.limit) ? opts.limit : null,
  });
  const reportPath = path.join(opts.outDir, `macrocycles-${opts.source}-report.json`);
  const save = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await save();
  if (opts.limit === Infinity && report.inputRows !== EXPECTED_ROWS[opts.source]) {
    throw new Error(`Source row count ${report.inputRows} differs from expected ${EXPECTED_ROWS[opts.source]}; report: ${reportPath}`);
  }
  if (report.rejectedRows / Math.max(1, report.inputRows) > 0.02) {
    throw new Error(`Over 2% source rows rejected; report: ${reportPath}`);
  }
  console.log(`${name}: ${report.acceptedRows}/${report.inputRows} rows, ${report.rejectedRows} rejected; source SHA-256 ${sourceSha256}`);
  console.log(`Normalized CSV: ${uploadCsv}; report: ${reportPath}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
