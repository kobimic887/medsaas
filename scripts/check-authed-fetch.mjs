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

// Routes that genuinely answer without authenticateToken in THIS repo
// (server/index.js — live 84 pyxis-web :5174 since 2026-08-23). chem_beo
// left many of these open; do not copy that inventory or Vite :5173.
// Adding a route here is a claim that the live handler has no
// authenticateToken — check first.
//
// Not public here: /company/branding (authenticateToken + requireActiveUser).
// A bare fetch 401s and the interceptor logs the user out.
// /health is the probe only — not /tanimoto/health or /asinex/health.
const PUBLIC_ROUTES = [
  '/mol-price-stats',
  '/mol-price/search',
  '/signin',
  // Public registration when ALLOW_PUBLIC_SIGNUP=true (default off). The
  // route still has no authenticateToken — closed installs return 403.
  '/signup',
  // Contact form: publicEmailRateLimit, no authenticateToken.
  '/send-email',
  '/demo-session',
  '/password-reset/request',
  '/password-reset/confirm',
  '/validate-token',
  '/health',
];

function mentionsPublicRoute(expr) {
  return PUBLIC_ROUTES.some((route) => {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Path must start at a quote or /api, not as a suffix of another path
    // (so /health does not match /tanimoto/health).
    return new RegExp(`(?:["'\`](?:/api)?|/api)${escaped}(?=["'\`/?#)]|$)`).test(expr);
  });
}

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
      if (mentionsPublicRoute(expr)) continue;

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
