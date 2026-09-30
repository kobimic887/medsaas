import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withSdfData } from './sdf.mjs';
/**
 * Python RDKit refinement wrapper. JSON over stdin/stdout; stderr stays in the service log and
 * is never returned to users. One refinement at a time by default; timeouts kill the child.
 */
export const REFINEMENT_LIMITS = Object.freeze({
  sdfBytes: 1_000_000,
  receptorBytes: 5 * 1024 * 1024,
  timeoutMs: 60_000,
  maxTimeoutMs: 300_000,
  stdoutBytes: 16 * 1024 * 1024,
  stderrBytes: 64 * 1024,
  statusTimeoutMs: 20_000,
  statusRetryMs: 60_000,
});
export const FORCE_FIELDS = Object.freeze(['auto', 'MMFF94', 'UFF']);
const script = fileURLToPath(new URL('refine.py', import.meta.url));
const python = () => process.env.LINK_FRAGMENTS_PYTHON || '/usr/bin/python3';
const concurrency = () => Math.max(1, Number.parseInt(process.env.LINK_FRAGMENTS_REFINE_CONCURRENCY, 10) || 1);
const failure = (code, message, extra) => ({ ok: false, errors: [{ code, message, ...extra }] });
const bytes = (text) => Buffer.byteLength(text, 'utf8');
// RDKit reads the molblock and writes a new one: it does not carry SD properties.
// Atom order survives AddHs (new H atoms are appended), so these source mappings
// remain valid for the refined download. Do not copy stale refinement properties.
const sourceKeys = new Set(['PYXIS_SOURCE_ATOM_MAP', 'PYXIS_ATTACHMENTS', 'PYXIS_FIXED_ATOMS',
  'PYXIS_LINKER_ID', 'PYXIS_CONFORMER_ID', 'PYXIS_LINKER_ATOMS', 'PYXIS_FIT_RMSD', 'PYXIS_ANCHOR_RMSD']);
function annotateRefinement(result, sdf) {
  const data = {};
  const record = sdf.replaceAll('\r', '').split('$$$$')[0];
  for (const match of record.matchAll(/^>[^\n]*<([^>]+)>[^\n]*\n([^\n]*(?:\n[^\n]+)*)/gm)) {
    if (sourceKeys.has(match[1])) data[match[1]] = match[2];
    if (match[1] === 'PYXIS_METHOD') data.PYXIS_PLACEMENT_METHOD = match[2];
  }
  data.PYXIS_METHOD = result.method;
  data.PYXIS_REFINEMENT_INITIAL_ENERGY_KCAL_MOL = String(result.initialEnergy);
  data.PYXIS_REFINEMENT_FIXED_MAX_DEVIATION_ANGSTROM = String(result.fixedAtoms.maxDeviation);
  data.PYXIS_REFINEMENT_STEREO_PRESERVED = String(result.stereo.preserved);
  if (result.receptor) {
    data.PYXIS_REFINEMENT_RECEPTOR_CLASHES_BEFORE = String(result.receptor.clashesBefore);
    data.PYXIS_REFINEMENT_RECEPTOR_CLASHES_AFTER = String(result.receptor.clashesAfter);
  }
  return withSdfData(result.sdf, data);
}
// A minimal environment: service secrets never reach the child process.
const childEnv = () => {
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' };
  for (const key of ['HOME', 'PYTHONPATH']) if (process.env[key]) env[key] = process.env[key];
  return env;
};
let active = 0;
const statusCache = new Map();

function runPython(args, input, timeoutMs, signal = null) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ aborted: true });
      return;
    }
    let child;
    try {
      child = spawn(python(), [script, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv() });
    } catch (e) {
      resolve({ spawnError: e });
      return;
    }
    const out = [];
    let outBytes = 0, errText = '', overflow = false, timedOut = false, aborted = false, settled = false;
    // Resolves only after the child has exited, so a caller's lock outlives the process.
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    function onAbort() {
      aborted = true;
      child.kill('SIGKILL');
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => {
      outBytes += chunk.length;
      if (outBytes > REFINEMENT_LIMITS.stdoutBytes) {
        overflow = true;
        child.kill('SIGKILL');
      } else out.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (errText.length < REFINEMENT_LIMITS.stderrBytes) errText += chunk.toString('utf8').slice(0, REFINEMENT_LIMITS.stderrBytes - errText.length);
    });
    child.on('error', (e) => finish({ spawnError: e }));
    child.on('close', (code, exitSignal) => finish({ code, signal: exitSignal, timedOut, aborted, overflow, stdout: Buffer.concat(out).toString('utf8'), stderr: errText }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** Cached probe of LINK_FRAGMENTS_PYTHON; failures are retried after a minute. */
export function refinementStatus({ refresh = false } = {}) {
  const key = python(), cached = statusCache.get(key);
  if (!refresh && cached && (cached.available || Date.now() - cached.at < REFINEMENT_LIMITS.statusRetryMs)) return cached.promise;
  const entry = { at: Date.now(), available: false };
  entry.promise = runPython(['--status'], '', REFINEMENT_LIMITS.statusTimeoutMs).then((run) => {
    let parsed = null;
    try {
      parsed = run.code === 0 && !run.timedOut ? JSON.parse(run.stdout) : null;
    } catch {}
    if (parsed?.available === true && typeof parsed.rdkitVersion === 'string') {
      entry.available = true;
      return { available: true, rdkitVersion: parsed.rdkitVersion, forceFields: ['MMFF94', 'UFF'] };
    }
    if (run.stderr) console.warn('link-fragments refinement probe failed:', run.stderr.slice(-500));
    return { available: false, rdkitVersion: null, forceFields: [], reason: 'Python RDKit is not available to the scientific service.' };
  });
  statusCache.set(key, entry);
  return entry.promise;
}

function validate(input) {
  const { sdf, fixedAtoms, fragmentAtomCount, forceField = 'auto', receptorPdb, maxIterations } = input || {};
  const positive = (n) => Number.isInteger(n) && n > 0;
  if (typeof sdf !== 'string' || !sdf.trim() || bytes(sdf) > REFINEMENT_LIMITS.sdfBytes) return failure('INVALID_REFINEMENT_INPUT', 'Supply a product SDF under 1 MB.');
  if (!positive(fragmentAtomCount)) return failure('INVALID_REFINEMENT_INPUT', 'fragmentAtomCount must be a positive integer.');
  if (!Array.isArray(fixedAtoms) || !fixedAtoms.length || fixedAtoms.length > 999 || !fixedAtoms.every(positive)) return failure('INVALID_REFINEMENT_INPUT', 'fixedAtoms must list 1-based atom numbers.');
  if (!FORCE_FIELDS.includes(forceField)) return failure('INVALID_REFINEMENT_INPUT', 'forceField must be auto, MMFF94 or UFF.');
  if (maxIterations !== undefined && !(Number.isInteger(maxIterations) && maxIterations >= 10 && maxIterations <= 10_000)) return failure('INVALID_REFINEMENT_INPUT', 'maxIterations must be an integer from 10 to 10000.');
  if (receptorPdb !== undefined && receptorPdb !== null && typeof receptorPdb !== 'string') return failure('INVALID_REFINEMENT_INPUT', 'receptorPdb must be PDB text.');
  if (typeof receptorPdb === 'string' && bytes(receptorPdb) > REFINEMENT_LIMITS.receptorBytes) return failure('RECEPTOR_TOO_LARGE', 'Receptor PDB must be 5 MB or smaller.');
  return null;
}

/**
 * Refine one product. Error codes: INVALID_REFINEMENT_INPUT; REFINEMENT_UNSUPPORTED and
 * RECEPTOR_TOO_LARGE|INVALID|EMPTY|OVERLAP|FRAME (unprocessable input); REFINEMENT_BUSY,
 * REFINEMENT_UNAVAILABLE, REFINEMENT_TIMEOUT, REFINEMENT_ABORTED and REFINEMENT_FAILED
 * (service side). `signal` (AbortSignal) kills the child; the slot is released once it exits.
 * serve.mjs passes timeoutMs (90 s) below the app relay (140 s) and the browser (150 s).
 */
export async function refineProduct(input = {}) {
  const invalid = validate(input);
  if (invalid) return invalid;
  const aborted = () => failure('REFINEMENT_ABORTED', 'Refinement was stopped because the request closed.');
  if (input.signal?.aborted) return aborted();
  if (active >= concurrency()) return failure('REFINEMENT_BUSY', 'Another refinement is running; try again shortly.');
  active++;
  try {
    const status = await refinementStatus();
    if (!status.available) return failure('REFINEMENT_UNAVAILABLE', status.reason);
    const timeoutMs = Math.min(REFINEMENT_LIMITS.maxTimeoutMs, Math.max(1, Number(input.timeoutMs) || REFINEMENT_LIMITS.timeoutMs));
    const request = { sdf: input.sdf, fixedAtoms: input.fixedAtoms, fragmentAtomCount: input.fragmentAtomCount, forceField: input.forceField || 'auto' };
    if (input.receptorPdb) request.receptorPdb = input.receptorPdb;
    if (input.maxIterations !== undefined) request.maxIterations = input.maxIterations;
    const run = await runPython([], JSON.stringify(request), timeoutMs, input.signal);
    if (run.aborted) return aborted();
    if (run.timedOut) return failure('REFINEMENT_TIMEOUT', `Refinement exceeded ${Math.round(timeoutMs / 1000)} s and was stopped.`);
    if (run.overflow) return failure('REFINEMENT_FAILED', 'Refinement output exceeded the size limit.');
    let result = null;
    try {
      result = run.spawnError ? null : JSON.parse(run.stdout);
    } catch {}
    if (run.stderr && (!result || !result.ok)) console.warn('link-fragments refinement stderr:', run.stderr.slice(-2000));
    if (!result || typeof result.ok !== 'boolean' || (!result.ok && !Array.isArray(result.errors))) return failure('REFINEMENT_FAILED', 'Refinement failed unexpectedly.');
    if (result.ok) result.sdf = annotateRefinement(result, input.sdf);
    return result;
  } finally {
    active--;
  }
}
