#!/usr/bin/env bun
// Weekly stock availability snapshot, scientific-host side (opt-in).
//
// Serves per-compound availability from the snapshots written by
// scripts/stock-availability-snapshot.mjs (<dir>/<date>/{manifest.json,availability.csv}).
// The combined loopback service mounts it under /stock-availability, so the app
// reuses the existing tunnel; the snapshot files never leave this host.
//
//   <dir>/ACTIVE.json  names the one snapshot that is live ({date, snapshotSha256}).
//                      No file (in an existing directory) = inactive: the app keeps its
//                      imported amounts. A missing directory is a failure, not inactive.
//
// Activation is explicit and pinned to the exact content: the pointer holds the
// CSV's SHA-256, so a same-date `--replace` of the snapshot is NOT picked up
// until it is activated again. Safety rules:
//   * A snapshot is validated completely before it can become live (activation
//     CLI) and again on every load. Anything that fails keeps the last good one.
//   * With a pointer but no good snapshot in memory (cold start, bad files) the
//     service answers 503 "failed", never "inactive": the app then mints no stock
//     offers instead of silently falling back to stale imported amounts.
//   * Loading never blocks or crashes the shared combined service; changes to the
//     pointer are noticed without a restart (checked at most once per `recheckMs`).
//
// CLI (run on this host; <dir> defaults to $STOCK_AVAILABILITY_DIR):
//   bun services/owned-search/stockAvailability.mjs status [--dir D]
//   bun services/owned-search/stockAvailability.mjs activate YYYY-MM-DD [--dir D]
//   bun services/owned-search/stockAvailability.mjs deactivate [--dir D]
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  STOCK_LOOKUP_MAX_CODES, STOCK_SNAPSHOT_FORMAT, STOCK_SNAPSHOT_HEADER, normalizeStockCode,
} from '../../server/utils/stockAvailability.js';

export const POINTER_FILE = 'ACTIVE.json';
const POINTER_FORMAT = 'pyxis-stock-availability-active-v1';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_LOOKUP_BODY = 1_000_000;
const RETRY_FAILED_MS = 30_000;

export class StockSnapshotError extends Error {
  constructor(message) { super(message); this.name = 'StockSnapshotError'; }
}
const bad = (message) => { throw new StockSnapshotError(message); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (file, what) => {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') bad(`${what} is missing`); throw error; }
  try { return JSON.parse(text); } catch { return bad(`${what} is not valid JSON`); }
};

/** The pointer, or null when nothing is activated. A damaged pointer throws. */
export async function readPointer(dir) {
  let text;
  try { text = await fs.readFile(path.join(dir, POINTER_FILE), 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Only "the directory exists and holds no ACTIVE.json" means inactive. A missing
    // or unmounted directory must not silently bring the imported amounts back.
    if (!(await fs.stat(dir).then((entry) => entry.isDirectory(), () => false))) bad('Snapshot directory is missing');
    return null;
  }
  let pointer;
  try { pointer = JSON.parse(text); } catch { return bad('ACTIVE.json is not valid JSON'); }
  if (pointer?.format !== POINTER_FORMAT || !DATE.test(pointer.date || '') || !SHA256.test(pointer.snapshotSha256 || '')) bad('ACTIVE.json is invalid');
  return pointer;
}

/** Read and fully validate one snapshot; the manifest and CSV come from one resolved revision. */
export async function loadSnapshot(dir, { date, snapshotSha256 }) {
  const root = await fs.realpath(dir);
  let revision;
  try { revision = await fs.realpath(path.join(root, date)); } catch { return bad(`Snapshot ${date} does not exist`); }
  if (path.dirname(revision) !== root) bad(`Snapshot ${date} resolves outside the snapshot directory`);
  const manifest = await readJson(path.join(revision, 'manifest.json'), 'manifest.json');
  if (manifest?.format !== STOCK_SNAPSHOT_FORMAT) bad('Snapshot format is not the expected version');
  if (manifest.asOf !== date) bad('Snapshot manifest date does not match its directory');
  if (manifest.snapshotSha256 !== snapshotSha256) bad('Snapshot content differs from the activated checksum; activate it again after review');
  if (!Number.isSafeInteger(manifest.compounds) || manifest.compounds < 1) bad('Snapshot manifest reports no compounds');
  const bytes = await fs.readFile(path.join(revision, 'availability.csv'));
  if (sha256(bytes) !== snapshotSha256) bad('availability.csv failed its checksum');
  const lines = bytes.toString('utf8').split('\n');
  if (lines.pop() !== '') bad('availability.csv must end with a newline');
  if (lines[0] !== STOCK_SNAPSHOT_HEADER.join(',')) bad('availability.csv header is not the expected one');
  const items = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const fields = lines[i].split(',');
    const [code, mg, um, vials] = fields;
    if (fields.length !== 4 || normalizeStockCode(code) !== code || items.has(code)) bad(`availability.csv row ${i + 1} is invalid or duplicated`);
    if (!DECIMAL.test(mg) || !DECIMAL.test(um) || !/^[1-9]\d*$/.test(vials)) bad(`availability.csv row ${i + 1} has an invalid amount`);
    const amount = Number(mg);
    if (!Number.isFinite(amount)) bad(`availability.csv row ${i + 1} has an invalid amount`);
    items.set(code, amount);
  }
  if (items.size !== manifest.compounds) bad('availability.csv row count does not match the manifest');
  return { date, asOf: manifest.asOf, snapshotSha256, revision, compounds: items.size, items, loadedAt: new Date().toISOString() };
}

/**
 * Keeps the active snapshot in memory. `lookup`/`status` revisit the pointer at
 * most once per `recheckMs`; a failed reload never discards a good snapshot.
 */
export function createStockAvailabilityStore({ dir, recheckMs = 1000, clock = Date.now } = {}) {
  if (!dir) throw new TypeError('A snapshot directory is required');
  let good = null;
  let failure = null;
  let checkedAt = -Infinity;
  let running = null;
  let failedKey = null;
  let failedAt = -Infinity;
  async function check() {
    try {
      const pointer = await readPointer(dir);
      if (!pointer) { good = null; failure = null; return; }
      const revision = await fs.realpath(path.join(await fs.realpath(dir), pointer.date)).catch(() => null);
      if (good && revision === good.revision && pointer.snapshotSha256 === good.snapshotSha256) { failure = null; return; }
      // Do not re-read a large file every second while the same pointer keeps failing.
      const key = `${revision}|${pointer.snapshotSha256}`;
      if (failure && failedKey === key && clock() - failedAt < RETRY_FAILED_MS) return;
      failedKey = key;
      failedAt = clock();
      good = await loadSnapshot(dir, pointer);
      failure = null;
    } catch (error) {
      failure = error instanceof StockSnapshotError ? error.message : 'Snapshot could not be read';
      if (!(error instanceof StockSnapshotError)) console.error('Stock availability snapshot read failed:', error.code || error.name);
    }
  }
  async function refresh() {
    if (running) return running;
    if (clock() - checkedAt < recheckMs) return undefined;
    running = check().finally(() => { checkedAt = clock(); running = null; });
    return running;
  }
  const describe = () => (good
    ? { state: 'active', date: good.date, asOf: good.asOf, snapshotSha256: good.snapshotSha256, compounds: good.compounds, loadedAt: good.loadedAt, ...(failure ? { degraded: failure } : {}) }
    : failure ? { state: 'failed', error: failure } : { state: 'inactive' });
  return {
    async status() { await refresh(); return { configured: true, ...describe() }; },
    async lookup(codes) {
      await refresh();
      const answer = describe();
      if (answer.state !== 'active') return answer;
      const items = {};
      for (const code of codes) { const key = normalizeStockCode(code); if (key !== null && good.items.has(key)) items[key] = good.items.get(key); }
      return { state: 'active', asOf: good.asOf, snapshotSha256: good.snapshotSha256, items };
    },
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_LOOKUP_BODY) return null; chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * HTTP handler for /stock-availability/{status,lookup}. `store` is null when
 * STOCK_AVAILABILITY_DIR is not configured: the feature is then inactive.
 * A failed state answers 503 so the app never reads it as "inactive".
 */
export function createStockAvailabilityHandler(store) {
  return async (req, res, pathname) => {
    try {
      if (pathname === '/stock-availability/status' && req.method === 'GET') {
        return sendJson(res, 200, store ? await store.status() : { configured: false, state: 'inactive' });
      }
      if (pathname === '/stock-availability/lookup' && req.method === 'POST') {
        const text = await readBody(req);
        let codes;
        try { codes = JSON.parse(text ?? '').codes; } catch { codes = null; }
        if (text === null || !Array.isArray(codes) || codes.length > STOCK_LOOKUP_MAX_CODES || codes.some((code) => typeof code !== 'string' || code.length > 64)) {
          return sendJson(res, 400, { error: `Send {"codes": [up to ${STOCK_LOOKUP_MAX_CODES} MAIN_BAS strings]}` });
        }
        const answer = store ? await store.lookup(codes) : { state: 'inactive' };
        return sendJson(res, answer.state === 'failed' ? 503 : 200, answer);
      }
      return sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      console.error('Stock availability request failed:', error.code || error.name);
      return sendJson(res, 503, { state: 'failed', error: 'Stock availability is unavailable' });
    }
  };
}

/** Validate a snapshot, then make it the live one (atomic pointer replace). */
export async function activateSnapshot(dir, date) {
  if (!DATE.test(date || '')) bad('Give the snapshot date as YYYY-MM-DD');
  const root = await fs.realpath(dir);
  const manifest = await readJson(path.join(await fs.realpath(path.join(root, date)).catch(() => bad(`Snapshot ${date} does not exist`)), 'manifest.json'), 'manifest.json');
  const snapshot = await loadSnapshot(dir, { date, snapshotSha256: String(manifest.snapshotSha256 || '') });
  const pointer = { format: POINTER_FORMAT, date, snapshotSha256: snapshot.snapshotSha256, activatedAt: new Date().toISOString() };
  const temporary = path.join(root, `.${POINTER_FILE}.${process.pid}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(pointer, null, 2)}\n`, { mode: 0o640 });
  await fs.rename(temporary, path.join(root, POINTER_FILE));
  return { ...pointer, compounds: snapshot.compounds };
}

/** Rollback to the imported amounts: remove the pointer. */
export async function deactivateSnapshot(dir) {
  await fs.rm(path.join(await fs.realpath(dir), POINTER_FILE), { force: true });
}

async function main(argv) {
  const [command, ...rest] = argv;
  let dir = process.env.STOCK_AVAILABILITY_DIR; let date;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--dir' && rest[i + 1]) dir = rest[++i]; else if (!date && !rest[i].startsWith('--')) date = rest[i]; else bad(`Unknown argument: ${rest[i]}`);
  }
  if (!dir) bad('Set STOCK_AVAILABILITY_DIR or pass --dir');
  if (command === 'activate') console.log(JSON.stringify(await activateSnapshot(dir, date), null, 2));
  else if (command === 'deactivate') { await deactivateSnapshot(dir); console.log('Deactivated: the app keeps its imported amounts.'); }
  else if (command === 'status') console.log(JSON.stringify(await createStockAvailabilityStore({ dir }).status(), null, 2));
  else bad('Usage: stockAvailability.mjs status | activate YYYY-MM-DD | deactivate  [--dir D]');
}

if (import.meta.main) main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof StockSnapshotError ? `Refused: ${error.message}` : error);
  process.exitCode = 1;
});
