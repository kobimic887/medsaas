// Bun --watch dev reload smoke: proves bun --watch index.js serves and reloads after a file touch.
//
// Run: npm --prefix server run test:runtime-watch
//
// Verifies D-01: bun --watch index.js serves the API and reloads after an imported server file changes.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fsp } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const BRANDING_FILE = path.resolve(SERVER_DIR, 'config/branding.js');

const BUN_PATH = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
const PORT = 3202;
const BASE = `http://127.0.0.1:${PORT}`;

// Timeouts
const STARTUP_TIMEOUT_MS = 40000;
const RELOAD_SIGNAL_TIMEOUT_MS = 15000;
const RELOAD_HEALTH_TIMEOUT_MS = 15000;

let passed = 0;
let failed = 0;
function check(label, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label} ${extra}`);
    failed++;
  }
}

async function waitForHealth(timeoutMs = STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function waitForHealthFailure(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/health`);
    } catch {
      return true; // connection refused — server went down
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false; // server never went down (timeout)
}

async function main() {
  console.log('[watch-smoke] Starting ephemeral MongoDB...');
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri('medsaas_watchsmoke');

  const childEnv = {
    ...process.env,
    MONGODB_URI: uri,
    JWT_SECRET: 'watchsmoke_jwt_secret_at_least_32_chars_long_xx',
    STRIPE_SECRET_KEY: 'sk_test_dummy_key_never_calls_api',
    STRIPE_WEBHOOK_SECRET: 'whsec_watchsmoke_test',
    PORT: String(PORT),
    NODE_ENV: 'test',
    NVIDIA_MOLMIM_API_KEY: '',
    FRONTEND_DIST: '',
  };

  console.log(`[watch-smoke] Spawning: ${BUN_PATH} --watch index.js`);
  const child = spawn(BUN_PATH, ['--watch', 'index.js'], {
    cwd: SERVER_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  // Count how many times the startup log appears — each reload adds one
  let startupCount = 0;
  function onData(d) {
    const text = d.toString();
    serverLog += text;
    // Bun prints the startup log on each watch reload
    if (text.includes('HTTP Server running on port')) {
      startupCount++;
    }
  }
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  const cleanup = async () => {
    try { child.kill('SIGKILL'); } catch {}
    try { await mem.stop(); } catch {}
  };

  try {
    // --- Step 1: initial startup ---
    console.log('\n[watch-smoke] Step 1 — initial startup:');
    const initialHealthy = await waitForHealth(STARTUP_TIMEOUT_MS);
    check('initial /health returns 200', initialHealthy, '(server did not become healthy)');
    if (!initialHealthy) {
      console.error('[watch-smoke] Server output:\n' + serverLog);
      throw new Error('initial-health-failed');
    }
    const countAfterInit = startupCount;

    // --- Step 2: touch branding.js (content-preserving rewrite, no text change) ---
    // fs.utimes (mtime-only) does not trigger Bun's FSEvents-based watch on macOS.
    // A content-preserving readFile+writeFile does trigger it — the file text is
    // identical; only the inode ctime changes (which FSEvents detects).
    console.log('\n[watch-smoke] Step 2 — touch config/branding.js (content-preserving rewrite):');
    const originalContent = await fsp.readFile(BRANDING_FILE, 'utf8');
    await fsp.writeFile(BRANDING_FILE, originalContent, 'utf8');
    check('branding.js rewritten with identical content', true);

    // --- Step 3: detect reload signal ---
    console.log('\n[watch-smoke] Step 3 — detect Bun watch reload:');
    // Strategy: wait for a second "HTTP Server running on port" log line,
    // which bun --watch emits on each hard restart.
    // As a fallback, also accept: server becomes unavailable then recovers.
    let reloadDetected = false;

    // Primary: wait for startupCount to increase
    const reloadSignalDeadline = Date.now() + RELOAD_SIGNAL_TIMEOUT_MS;
    while (Date.now() < reloadSignalDeadline) {
      if (startupCount > countAfterInit) {
        reloadDetected = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    // Fallback: if startup log not seen, check if server went briefly unavailable then recovered
    if (!reloadDetected) {
      const wentDown = await waitForHealthFailure(3000);
      if (wentDown) {
        const cameBack = await waitForHealth(RELOAD_HEALTH_TIMEOUT_MS);
        reloadDetected = cameBack;
      }
    }

    check('bun --watch triggered a server restart', reloadDetected, '(no reload signal detected within timeout)');

    // --- Step 4: post-reload health ---
    console.log('\n[watch-smoke] Step 4 — post-reload /health:');
    const postReloadHealthy = await waitForHealth(RELOAD_HEALTH_TIMEOUT_MS);
    check('post-reload /health returns 200', postReloadHealthy, '(server did not recover after reload)');

    if (!reloadDetected || !postReloadHealthy) {
      console.error('[watch-smoke] Server log:\n' + serverLog);
    }
  } finally {
    await cleanup();
  }

  console.log(`\n${'='.repeat(48)}`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(48));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[watch-smoke] Harness error:', err);
  process.exit(1);
});
