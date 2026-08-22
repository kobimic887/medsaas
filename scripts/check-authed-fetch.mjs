#!/usr/bin/env node
// Guard against the bug that signed users out of Simulation Results.
//
// Every same-origin 401 is treated by client/src/utils/authInterceptor.js as a dead
// session: it clears auth storage and hard-redirects to /auth/sign-in. So a client
// fetch() to one of our own protected /api routes that forgets the Authorization
// header does not degrade gracefully — it logs the user out of a working session.
//
// That shipped twice: molstar3d.jsx (three call sites, broke the whole page on load)
// and dashboard-navbar.jsx (the compound cart enquiry). This scans for a third.
//
// The check is deliberately dumb: for every fetch() whose call expression mentions
// buildApiUrl/buildUrl or a literal /api/ path, require either an Authorization
// header in the same expression or an entry in PUBLIC_ROUTES below.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = ['client/src'];

// Routes that genuinely answer without a token. Verified against production on
// 2026-07-30 — each returns 200 unauthenticated. Adding a route here is a claim
// that the server does NOT put authenticateToken in front of it; check first.
const PUBLIC_ROUTES = [
  '/mol-price-stats',
  '/mol-price/search',
  '/signin',
  // Public registration. `POST /api/signup` has no authenticateToken in front of it — the
  // caller has no account yet, which is the point. Gated by ALLOW_PUBLIC_SIGNUP (default on).
  '/signup',
  // The contact form. `POST /api/send-email` is rate-limited but unauthenticated —
  // server/index.js:6037 has publicEmailRateLimit and no authenticateToken.
  '/send-email',
  '/demo-session',
  '/password-reset/request',
  '/password-reset/confirm',
  '/validate-token',
  '/company/branding',
  '/health',
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (/\.(jsx?|mjs)$/.test(entry)) {
      yield full;
    }
  }
}

// Grab the source slice for one fetch( call by walking parens to the matching close.
function callExpression(source, fetchIndex) {
  const open = source.indexOf('(', fetchIndex);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(fetchIndex, i + 1);
    }
  }
  return source.slice(fetchIndex, fetchIndex + 2000);
}

const failures = [];

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const source = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);

    // The interceptor itself wraps window.fetch — it is the mechanism, not a caller.
    if (rel.endsWith('utils/authInterceptor.js')) continue;

    for (const match of source.matchAll(/\bfetch\s*\(/g)) {
      const expr = callExpression(source, match.index);
      const targetsOurApi = /buildApiUrl|buildUrl|["'`]\/api\//.test(expr);
      if (!targetsOurApi) continue;
      if (/Authorization/i.test(expr)) continue;
      if (PUBLIC_ROUTES.some((route) => expr.includes(route))) continue;

      const line = source.slice(0, match.index).split('\n').length;
      failures.push(`${rel}:${line}  fetch() to our API with no Authorization header`);
    }
  }
}

if (failures.length > 0) {
  console.error('\nUnauthenticated fetch to a protected route.\n');
  console.error('A same-origin 401 logs the user out (client/src/utils/authInterceptor.js),');
  console.error('so this does not fail softly — it ends the session.\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nFix: add the conditional Authorization: Bearer <token> header using');
  console.error('getAuthToken() from @/utils/constants — or, if the route really is public,');
  console.error('add it to PUBLIC_ROUTES in scripts/check-authed-fetch.mjs.\n');
  process.exit(1);
}

console.log('authed-fetch check: no unauthenticated calls to protected routes');
