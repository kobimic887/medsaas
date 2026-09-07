// Staging-build verifier: proves the isolated /staging/ build stays scoped.
//
// Builds the client in staging mode into client/dist-staging (the normal
// client/dist is NOT touched — the production default stays intact) and checks:
//   - index.html carries <meta name="robots" content="noindex,nofollow">
//   - asset URLs are rooted at /staging/assets/...
//   - the runtime base-path module compiled to "/staging"
//   - the folding chunk still references its viewer/sample assets through the
//     base-aware helper (literal root paths would escape staging)
//
// Run: bun scripts/check-staging-build.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'client', 'dist-staging');
const distAssets = path.join(OUT_DIR, 'assets');

let passed = 0;
let failed = 0;
function check(label, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label} ${extra}`);
    failed += 1;
  }
}

console.log('[staging-build] Building client in staging mode (--mode staging)…');
execFileSync('bun', ['run', 'build:staging', '--', '--outDir', 'dist-staging'], {
  cwd: path.join(ROOT, 'client'),
  stdio: 'inherit',
  env: { ...process.env },
});

const indexHtml = fs.readFileSync(path.join(OUT_DIR, 'index.html'), 'utf8');
check('index.html has noindex meta', /<meta name="robots" content="noindex,nofollow"/.test(indexHtml));

const assetRefs = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const entryRefs = assetRefs.filter((r) => r.includes('/assets/'));
check('bundled assets are rooted at /staging/assets/', entryRefs.length > 0 && entryRefs.every((r) => r.startsWith('/staging/assets/')), entryRefs.join(','));

const appEnvFiles = fs.readdirSync(distAssets).filter((f) => f.startsWith('appEnv-'));
const appEnv = appEnvFiles.map((f) => fs.readFileSync(path.join(distAssets, f), 'utf8')).join('\n');
check('runtime base path compiled to /staging/', appEnv.includes('`/staging/`'));

const allJs = fs.readdirSync(distAssets)
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(distAssets, f), 'utf8'))
  .join('\n');
check('staging namespace prefix present', allJs.includes('pxstg__'));
check('folding history client present', allJs.includes('folding-history'));

// Source-level guard: any app-authored literal for the in-app iframes/samples
// must be routed through withAppBase() so it cannot escape the staging scope.
const SRC = path.join(ROOT, 'client', 'src');
const targets = ['/molstar/index.html', '/ketcher/index.html', '/folding-samples/'];
const offenders = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.[jt]sx?$/.test(entry.name)) {
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // Comments/URLs in prose are not app-authored resource references.
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (targets.some((t) => line.includes(t)) && !line.includes('withAppBase')) {
          offenders.push(`${path.relative(ROOT, full)}:${i + 1}`);
        }
      });
    }
  }
}
walk(SRC);
check('in-app iframe/sample literals are base-aware in source', offenders.length === 0, offenders.join(','));

console.log(`\n[staging-build] ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
