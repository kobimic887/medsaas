#!/usr/bin/env node
/**
 * Backfill `username` and `companyId` onto legacy simulation_logs documents.
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/migrate-legacy-users.mjs` fixes the `users` collection and stops there. That is not
 * enough, and the gap only opens *because* that script succeeds.
 *
 * Once every user has a `companyId`, `buildTenantFilter` (server/index.js:1065) stops taking the
 * legacy branch and returns `{companyId}` for everyone:
 *
 *     if (user?.companyId) return { companyId: user.companyId };      // after the user migration
 *     if (user?.username)  return { 'user.username': user.username }; // before it
 *
 * Every simulation_logs document in production was written by `chem_beo`, which nests
 * `user: {username, iat, exp}` and writes **no `companyId` at all** — verified against Atlas on
 * 2026-07-29: 5 documents, 5 with `user.username`, 0 with `username`, 0 with `companyId`.
 *
 * So the moment the user migration lands, that filter matches nothing, and:
 *
 *   - `/api/simulation-logs` returns empty. Every user's dock history disappears.
 *   - `/api/simulation` (GET and POST) looks up the cache with
 *     `findOne({...tenantFilter, pdbid, smiles})` — server/index.js:3165. It misses, so an
 *     identical re-dock **charges a credit again for a dock already paid for** and re-runs it.
 *
 * That is the same failure the runbook attributes to reusing `chem_beo`'s JWT_SECRET, but it
 * arrives by a different road and rotating the secret does not prevent it.
 *
 * DESIGN — additive only, so rollback still works
 * -----------------------------------------------
 * This never removes or rewrites `user`. `chem_beo` reads `user.username` and is the rollback
 * target for at least a week after cutover (runbook 5.0 step 9); deleting the field it reads
 * would make the rollback lossy. After this runs, a document carries BOTH shapes and either
 * server can find it. That redundancy is the point, not an oversight.
 *
 * Idempotent. Only fills what is missing. Re-running is a no-op; a partial run can be re-run.
 *
 * USAGE
 * -----
 *   node scripts/migrate-legacy-simulation-logs.mjs --uri "$MONGODB_URI"
 *   node scripts/migrate-legacy-simulation-logs.mjs --uri "$MONGODB_URI" --apply --yes-i-have-a-backup
 *
 * Flags:
 *   --uri <s>              connection string. Falls back to $MONGODB_URI.
 *   --db <s>               database name. Default `test` — the production URI carries none, so
 *                          the driver falls back to `test`, and that is where the data is.
 *   --company <id>         companyId to stamp. Default: the single existing company. Fails
 *                          loudly if there are several, rather than guessing a tenant.
 *   --set-company-name     also stamp companyName. OFF by default, matching
 *                          migrate-legacy-users.mjs — branding comes from PLATFORM_NAME.
 *   --apply                actually write.
 *   --yes-i-have-a-backup  required alongside --apply.
 *   --verbose              print every document and its proposed change.
 *
 * Run it AFTER migrate-legacy-users.mjs, in the same maintenance window. Running it before is
 * harmless but pointless — the window of breakage is between the two.
 */

import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const URI = opt('uri', process.env.MONGODB_URI);
const DB_NAME = opt('db', 'test');
const APPLY = flag('apply');
const CONFIRMED = flag('yes-i-have-a-backup');
const VERBOSE = flag('verbose');
const SET_COMPANY_NAME = flag('set-company-name');

if (!URI) {
  console.error('No connection string. Pass --uri or set MONGODB_URI.');
  process.exit(2);
}
if (APPLY && !CONFIRMED) {
  console.error('--apply requires --yes-i-have-a-backup. This edits production simulation_logs.');
  process.exit(2);
}

const client = new MongoClient(URI);

/** The username a legacy document carries, wherever it put it. */
function legacyUsername(doc) {
  if (typeof doc.username === 'string' && doc.username) return doc.username;
  if (doc.user && typeof doc.user.username === 'string' && doc.user.username) return doc.user.username;
  if (typeof doc.user === 'string' && doc.user) return doc.user;
  return null;
}

async function main() {
  await client.connect();
  const db = client.db(DB_NAME);
  const logs = db.collection('simulation_logs');
  const companies = db.collection('companies');

  // Same rule as migrate-legacy-users.mjs: never guess a tenant. Putting a result in the wrong
  // company exposes one tenant's docking output to another.
  let companyId = opt('company');
  let company;
  if (companyId) {
    company = await companies.findOne({ companyId });
    if (!company) throw new Error(`No company with companyId=${companyId}`);
  } else {
    const all = await companies.find({}).toArray();
    if (all.length === 0) throw new Error('No companies exist. Run migrate-legacy-users.mjs first.');
    if (all.length > 1) {
      throw new Error(
        `${all.length} companies exist, so the target is ambiguous. Re-run with --company <companyId>.\n` +
        all.map((c) => `  ${c.companyId}  ${c.name}`).join('\n')
      );
    }
    company = all[0];
    companyId = company.companyId;
  }

  console.log(`database   : ${DB_NAME}`);
  console.log(`company    : ${company.name || '(unnamed)'} (${companyId})`);
  console.log(`mode       : ${APPLY ? 'APPLY — will write' : 'DRY RUN — no writes'}`);
  console.log('');

  const all = await logs.find({}).toArray();
  const now = new Date();
  const stats = { total: all.length, untouched: 0, username: 0, companyId: 0, companyName: 0, orphaned: [] };
  const plan = [];

  for (const doc of all) {
    const name = legacyUsername(doc);
    if (!name) {
      // No username in any shape. Stamping companyId alone would make it visible to the whole
      // tenant while belonging to nobody — leave it and report it.
      stats.orphaned.push(String(doc._id));
      continue;
    }

    const set = {};
    if (typeof doc.username !== 'string' || !doc.username) { set.username = name; stats.username++; }
    if (doc.companyId === undefined || doc.companyId === null) { set.companyId = companyId; stats.companyId++; }
    if (SET_COMPANY_NAME && !doc.companyName) { set.companyName = company.name || null; stats.companyName++; }

    if (Object.keys(set).length === 0) { stats.untouched++; continue; }
    plan.push({ _id: doc._id, username: name, simulationKey: doc.simulationKey, set });
  }

  if (VERBOSE) {
    for (const p of plan) console.log(`  ${p.username}  ${p.simulationKey || '(no key)'}: ${JSON.stringify(p.set)}`);
    console.log('');
  }

  console.log(`simulation_logs total           : ${stats.total}`);
  console.log(`already correct, untouched      : ${stats.untouched}`);
  console.log(`to change                       : ${plan.length}`);
  console.log(`  + username (from user.username): ${stats.username}`);
  console.log(`  + companyId                   : ${stats.companyId}`);
  console.log(`  + companyName                 : ${stats.companyName}${SET_COMPANY_NAME ? '' : '   (skipped — branding comes from PLATFORM_NAME)'}`);
  console.log('');
  console.log('`user` is left in place on every document, so chem_beo can still read them after a rollback.');

  if (stats.orphaned.length) {
    console.log('');
    console.log('ORPHANED — no username in any shape, left untouched, fix by hand:');
    for (const id of stats.orphaned) console.log(`  _id ${id}`);
  }

  if (!APPLY) {
    console.log('');
    console.log('Dry run. Nothing written. Re-run with --apply --yes-i-have-a-backup to write.');
    return;
  }

  let written = 0;
  for (const p of plan) {
    const r = await logs.updateOne({ _id: p._id }, { $set: { ...p.set, updatedAt: now } });
    written += r.modifiedCount;
  }
  console.log('');
  console.log(`WROTE ${written} documents.`);

  // ── Verify, do not assume ───────────────────────────────────────────────
  const noCompany = await logs.countDocuments({ companyId: { $exists: false } });
  const noUsername = await logs.countDocuments({ username: { $exists: false } });
  const lostLegacy = await logs.countDocuments({ 'user.username': { $exists: false } });
  console.log('');
  console.log(`VERIFY logs without companyId   : ${noCompany}   (requires 0, minus any orphans above)`);
  console.log(`VERIFY logs without username    : ${noUsername}   (requires 0, minus any orphans above)`);
  console.log(`VERIFY logs that lost user.username: ${lostLegacy}   (must equal what it was before — this script must not remove it)`);

  const expectedOrphans = stats.orphaned.length;
  if (noCompany > expectedOrphans || noUsername > expectedOrphans) {
    console.error('\nVERIFICATION FAILED. Do not cut over. Investigate before re-running.');
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; })
  .finally(() => client.close());
