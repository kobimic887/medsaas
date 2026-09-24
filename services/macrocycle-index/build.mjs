#!/usr/bin/env bun
// Build an immutable, compact index from import-macrocycle-datasets.mjs output.
// Runs on a coding box; the resulting files are copied to staging separately.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { loadRDKit } from '../../server/utils/openCompounds.js';
import {
  DATASETS, FINGERPRINT_BYTES, FINGERPRINT_DETAILS, NORMALIZED_HEADER,
  POPCOUNT, RECORD_BYTES,
} from './common.mjs';

function argumentsFrom(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') args.source = argv[++i];
    else if (argv[i] === '--input') args.input = argv[++i];
    else if (argv[i] === '--out-dir') args.outDir = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!DATASETS[args.source] || !args.input || !args.outDir) {
    throw new Error('Usage: bun build.mjs --source real|virtual --input normalized.csv --out-dir directory');
  }
  return args;
}

async function fileSha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

async function build({ source, input, outDir }) {
  const definition = DATASETS[source];
  await fsp.mkdir(outDir, { recursive: true });
  const fpName = `${source}.fpb`;
  const rowsName = `${source}.rows.csv`;
  const fpTemp = path.join(outDir, `${fpName}.partial`);
  const rowsTemp = path.join(outDir, `${rowsName}.partial`);
  const fpFd = fs.openSync(fpTemp, 'w');
  const rowsFd = fs.openSync(rowsTemp, 'w');
  const rdkit = await loadRDKit();
  const recordBatch = Buffer.allocUnsafe(RECORD_BYTES * 4096);
  let batchRows = 0;
  let csvParts = [];
  let csvBatchBytes = 0;
  let csvOffset = 0;
  let sourceRows = 0;
  let indexedRows = 0;
  let invalidSmiles = 0;
  const invalidExamples = [];

  const flushRecords = () => {
    if (!batchRows) return;
    fs.writeSync(fpFd, recordBatch.subarray(0, batchRows * RECORD_BYTES));
    batchRows = 0;
  };
  const flushCsv = () => {
    if (!csvParts.length) return;
    fs.writeSync(rowsFd, Buffer.from(csvParts.join(''), 'utf8'));
    csvParts = [];
    csvBatchBytes = 0;
  };

  try {
    const lines = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
    let headerSeen = false;
    for await (const line of lines) {
      if (!headerSeen) {
        headerSeen = true;
        if (line.replace(/^\uFEFF/, '') !== NORMALIZED_HEADER.join(',')) {
          throw new Error('Normalized CSV header differs from the macrocycle import contract');
        }
        continue;
      }
      if (!line) continue;
      sourceRows++;
      // The supplied normalized files contain no quoted SMILES; reject any
      // unexpected shape rather than indexing a different structure.
      const comma = line.indexOf(',');
      if (comma < 1 || line[0] === '"') throw new Error(`Unexpected CSV structure at row ${sourceRows}`);
      const smiles = line.slice(0, comma);
      const mol = rdkit.get_mol(smiles);
      if (!mol) {
        invalidSmiles++;
        if (invalidExamples.length < 25) invalidExamples.push({ row: sourceRows, smiles: smiles.slice(0, 120) });
        continue;
      }
      let fp;
      try { fp = mol.get_morgan_fp_as_uint8array(FINGERPRINT_DETAILS); }
      finally { mol.delete(); }
      if (!fp || fp.length !== FINGERPRINT_BYTES) throw new Error(`RDKit fingerprint failure at row ${sourceRows}`);

      const pos = batchRows * RECORD_BYTES;
      recordBatch.writeBigUInt64LE(BigInt(csvOffset), pos);
      let bitCount = 0;
      for (let i = 0; i < FINGERPRINT_BYTES; i++) bitCount += POPCOUNT[fp[i]];
      recordBatch.writeUInt16LE(bitCount, pos + 8);
      recordBatch.set(fp, pos + 10);
      batchRows++;
      indexedRows++;
      if (batchRows === 4096) flushRecords();

      const csvLine = `${line}\n`;
      const bytes = Buffer.byteLength(csvLine);
      csvParts.push(csvLine);
      csvBatchBytes += bytes;
      csvOffset += bytes;
      if (csvBatchBytes >= 4 * 1024 * 1024) flushCsv();
      if (sourceRows % 100000 === 0) {
        console.log(`${source}: ${sourceRows.toLocaleString()} scanned, ${indexedRows.toLocaleString()} indexed`);
      }
    }
    flushRecords();
    flushCsv();
    fs.fsyncSync(fpFd);
    fs.fsyncSync(rowsFd);
  } finally {
    fs.closeSync(fpFd);
    fs.closeSync(rowsFd);
  }

  if (sourceRows !== definition.expectedRows) throw new Error(`Expected ${definition.expectedRows} normalized rows, got ${sourceRows}`);
  if (invalidSmiles / sourceRows > 0.02) throw new Error(`RDKit rejected ${invalidSmiles} rows (>2%); inspect before publication`);
  const fpPath = path.join(outDir, fpName);
  const rowsPath = path.join(outDir, rowsName);
  await fsp.rename(fpTemp, fpPath);
  await fsp.rename(rowsTemp, rowsPath);
  const manifest = {
    formatVersion: 1, source, datasetId: definition.id, datasetName: definition.name,
    sourceRows, indexedRows, invalidSmiles, invalidExamples,
    fingerprint: 'RDKit Morgan radius 2, 2048-bit, chirality off, binary Tanimoto',
    normalizedInputSha256: await fileSha256(input),
    fingerprintsFile: fpName, rowsFile: rowsName,
    fingerprintsBytes: (await fsp.stat(fpPath)).size, rowsBytes: (await fsp.stat(rowsPath)).size,
    generatedAt: new Date().toISOString(),
  };
  if (manifest.fingerprintsBytes !== indexedRows * RECORD_BYTES) throw new Error('Fingerprint file size mismatch');
  await fsp.writeFile(path.join(outDir, `${source}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${source}: indexed ${indexedRows}/${sourceRows}, RDKit rejected ${invalidSmiles}`);
}

build(argumentsFrom(process.argv.slice(2))).catch((error) => { console.error(error); process.exitCode = 1; });
