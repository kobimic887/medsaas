#!/usr/bin/env bun
/**
 * Scheduled, guarded refresh of the live stock availability snapshot (scientific host).
 *
 * Runs weekly (deploy/stock-availability/pyxis-stock-availability-refresh.timer). Most runs
 * do nothing: the publisher issues a new dated full dump only occasionally. When a
 * STRICTLY NEWER `STRUCTURES_FullDump_<YYYYMMDD>_<records>.zip` appears in the
 * same CompChem directory the shop was activated from, this job downloads it to a
 * private temporary directory, builds the snapshot with the same tool and guards an
 * operator would use (`scripts/stock-availability-snapshot.mjs`), activates it and
 * checks that the running search service reports it.
 *
 * What it never does:
 *  - No override flags (`--replace`, `--allow-large-change`, `--allow-new-tags`).
 *    A dump that trips a guard is refused and a person decides; see REFUSED_FLAGS.
 *  - No backwards or sideways switch: only a dump dated after the active snapshot.
 *  - No activation when nothing is active (`ACTIVE.json` absent = an operator
 *    deactivated it on purpose) or when the pointer changed while the job ran.
 *  - No deletion: the last good snapshot and every older one stay on disk.
 *
 * A refused or failed run leaves the active snapshot untouched and exits non-zero
 * (1 refused / verification failed, 2 operational error). An activation that the
 * service does not confirm is reverted to the previous snapshot.
 *
 * Usage: bun scripts/stock-availability-refresh.mjs --dir <stock-availability dir>
 *          [--source-url https://…/CompChem/] [--status-url http://127.0.0.1:8276/stock-availability/status]
 *          [--notify kobi-notify] [--dry-run]
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activateSnapshot, readPointer } from '../services/owned-search/stockAvailability.mjs';
import { parseDumpName } from './stock-availability-snapshot.mjs';

export const DEFAULT_SOURCE_URL = 'https://spectra.pyxis-discovery.com/CompChem/';
export const DEFAULT_STATUS_URL = 'http://127.0.0.1:8276/stock-availability/status';
// Flags that bypass a guard. The job must never pass them (asserted by the tests).
export const REFUSED_FLAGS = Object.freeze(['--replace', '--allow-large-change', '--allow-new-tags']);
const MAX_INDEX_BYTES = 2_000_000;
const MAX_DUMP_BYTES = 4 * 1024 ** 3;
const FUTURE_DAYS = 2;
const here = path.dirname(fileURLToPath(import.meta.url));

export class RefreshRefused extends Error {
  constructor(message, code = 1) { super(message); this.name = 'RefreshRefused'; this.code = code; }
}
const refuse = (message) => { throw new RefreshRefused(message, 1); };
const failed = (message) => { throw new RefreshRefused(message, 2); };

/** Strict dump listing: only plain `href` file names that parse as a full dump. */
export function listDumps(html) {
  const found = new Map();
  for (const match of String(html).matchAll(/href\s*=\s*"([^"?#]+)"/gi)) {
    let name;
    try { name = decodeURIComponent(match[1]); } catch { continue; }
    if (name !== path.posix.basename(name) || name.includes('\\')) continue;
    const parsed = parseDumpName(name);
    if (parsed && name === `STRUCTURES_FullDump_${parsed.asOf.replaceAll('-', '')}_${parsed.expectedRecords}.zip`) found.set(name, { name, ...parsed });
  }
  return [...found.values()].sort((a, b) => (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : 0));
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000), redirect: 'follow' });
  if (!response.ok) failed(`Dump index answered HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_INDEX_BYTES) failed('Dump index is unexpectedly large');
  return text;
}

async function download(url, file, { fetchImpl, maxBytes }) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(2 * 60 * 60 * 1000), redirect: 'follow' });
  if (!response.ok || !response.body) failed(`Dump download answered HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) refuse('Dump is larger than the allowed size');
  let bytes = 0;
  const counter = new Transform({ transform(chunk, _enc, cb) { bytes += chunk.length; cb(bytes > maxBytes ? new Error('Dump exceeds the allowed size') : null, chunk); } });
  await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(file, { mode: 0o600 }));
  if (Number.isFinite(declared) && declared > 0 && bytes !== declared) failed(`Dump download is incomplete (${bytes} of ${declared} bytes)`);
  if (bytes < 1) failed('Dump download is empty');
  return bytes;
}

function run(cmd, args, { stdin } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out = (out + d).slice(-8000); });
    child.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    child.on('error', (error) => resolve({ code: 127, out, err: String(error.message) }));
    child.on('close', (code) => resolve({ code, out, err }));
    if (stdin) stdin(child.stdin);
  });
}

/** unzip -p <zip> | snapshot tool; both must succeed. Returns the tool's output. */
async function buildSnapshot({ zip, sourceName, dir, previousCsv, toolArgsOut }) {
  const toolArgs = [path.join(here, 'stock-availability-snapshot.mjs'), '--input', '-', '--source-name', sourceName, '--out-dir', dir, '--previous', previousCsv];
  toolArgsOut.push(...toolArgs);
  const unzip = spawn('unzip', ['-p', zip], { stdio: ['ignore', 'pipe', 'pipe'] });
  let unzipErr = ''; unzip.stderr.on('data', (d) => { unzipErr = (unzipErr + d).slice(-2000); });
  const unzipDone = new Promise((resolve) => { unzip.on('error', (e) => { unzipErr = String(e.message); resolve(127); }); unzip.on('close', resolve); });
  const tool = run(process.execPath, toolArgs, { stdin: (writable) => { unzip.stdout.pipe(writable); writable.on('error', () => {}); } });
  const [unzipCode, result] = await Promise.all([unzipDone, tool]);
  if (unzipCode !== 0) refuse(`The dump could not be unzipped (${unzipErr.trim() || `exit ${unzipCode}`})`);
  if (result.code !== 0) refuse(`The snapshot tool refused the dump: ${(result.err || result.out).trim().split('\n').slice(-3).join(' | ')}`);
  return result.out.trim();
}

async function confirmActive({ statusUrl, date, sha, fetchImpl, waitMs = 20_000 }) {
  const deadline = Date.now() + waitMs;
  let last = 'unreachable';
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(statusUrl, { signal: AbortSignal.timeout(3000) });
      const status = await response.json();
      last = `${status.state} ${status.date || ''}`;
      if (status.state === 'active' && status.date === date && status.snapshotSha256 === sha) return true;
    } catch { last = 'unreachable'; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
}

/**
 * One refresh attempt. Resolves { outcome, ... } for a clean no-op or success and
 * throws RefreshRefused for anything a person should look at.
 */
export async function refresh({
  dir, sourceUrl = DEFAULT_SOURCE_URL, statusUrl = DEFAULT_STATUS_URL, fetchImpl = fetch,
  maxBytes = MAX_DUMP_BYTES, dryRun = false, now = () => new Date(), hooks = {}, confirmWaitMs,
} = {}) {
  if (!dir) failed('--dir is required');
  try { await fs.access(dir); } catch { failed(`Snapshot directory ${dir} does not exist (it is created by an operator, not by this job)`); }
  const pointer = await readPointer(dir).catch((error) => refuse(`ACTIVE.json is unusable: ${error.message}`));
  if (!pointer) return { outcome: 'inactive', message: 'No snapshot is activated (an operator deactivated it): not activating anything automatically.' };

  const base = sourceUrl.endsWith('/') ? sourceUrl : `${sourceUrl}/`;
  const dumps = listDumps(await fetchText(base, fetchImpl));
  if (!dumps.length) refuse('The dump index lists no STRUCTURES_FullDump_<date>_<records>.zip files (format change?); nothing was changed.');
  const newest = dumps[0];
  const sameDate = dumps.filter((dump) => dump.asOf === newest.asOf);
  if (sameDate.length > 1) refuse(`The index lists ${sameDate.length} different dumps dated ${newest.asOf}; a person must choose.`);
  if (newest.asOf <= pointer.date) return { outcome: 'no-newer', active: pointer.date, newest: newest.asOf, message: `Newest published dump (${newest.asOf}) is not newer than the active snapshot (${pointer.date}).` };
  const limit = new Date(now().getTime() + FUTURE_DAYS * 86400_000).toISOString().slice(0, 10);
  if (newest.asOf > limit) refuse(`The newest dump is dated ${newest.asOf}, in the future; refusing.`);
  if (dryRun) return { outcome: 'dry-run', active: pointer.date, candidate: newest.name };

  const previousCsv = path.join(dir, pointer.date, 'availability.csv');
  try { await fs.access(previousCsv); } catch { refuse(`The active snapshot's CSV is missing (${previousCsv}); not building on a damaged base.`); }

  const work = await fs.mkdtemp(path.join(dir, '.refresh-'));
  await fs.chmod(work, 0o700);
  const toolArgs = [];
  try {
    const zip = path.join(work, newest.name);
    const bytes = await download(new URL(newest.name, base).href, zip, { fetchImpl, maxBytes });
    const summary = await buildSnapshot({ zip, sourceName: newest.name, dir, previousCsv, toolArgsOut: toolArgs });
    await hooks.beforeActivate?.();
    const current = await readPointer(dir);
    if (!current || current.date !== pointer.date || current.snapshotSha256 !== pointer.snapshotSha256) refuse('ACTIVE.json changed while the job ran; leaving it alone. The new snapshot is built but not activated.');
    const activated = await activateSnapshot(dir, newest.asOf);
    const confirmed = await confirmActive({ statusUrl, date: newest.asOf, sha: activated.snapshotSha256, fetchImpl, waitMs: confirmWaitMs });
    if (confirmed !== true) {
      await activateSnapshot(dir, pointer.date);
      refuse(`The service did not report ${newest.asOf} as active (${confirmed}); reverted to ${pointer.date}.`);
    }
    return { outcome: 'activated', date: newest.asOf, previous: pointer.date, bytes, compounds: activated.compounds, summary, toolArgs };
  } catch (error) {
    if (error instanceof RefreshRefused) error.toolArgs = toolArgs;
    throw error;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const valued = { '--dir': 'dir', '--source-url': 'sourceUrl', '--status-url': 'statusUrl', '--notify': 'notify' };
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') options.dryRun = true;
    else if (valued[argv[i]] && i + 1 < argv.length) options[valued[argv[i]]] = argv[++i];
    else throw new RefreshRefused(`Unknown argument ${argv[i]}`, 2);
  }
  options.dir ||= process.env.STOCK_AVAILABILITY_DIR;
  return options;
}

async function notify(command, title, message) {
  if (!command) return;
  await run(command, [title, message]).catch(() => {});
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); return 2; }
  const { notify: notifyCommand, ...rest } = options;
  try {
    const result = await refresh(rest);
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result, toolArgs: undefined }));
    if (result.outcome === 'activated') await notify(notifyCommand, 'Stock availability updated', `Activated the ${result.date} dump (${result.compounds} compounds); previous ${result.previous} kept for rollback.`);
    return 0;
  } catch (error) {
    if (!(error instanceof RefreshRefused)) { console.error(error); await notify(notifyCommand, 'Stock availability refresh failed', 'Unexpected error; the active snapshot is unchanged. See the journal.'); return 2; }
    console.error(`stock availability refresh refused: ${error.message}`);
    await notify(notifyCommand, 'Stock availability refresh refused', `${error.message} The active snapshot is unchanged.`.slice(0, 400));
    return error.code;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main();
