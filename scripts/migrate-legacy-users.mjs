#!/usr/bin/env node
/**
 * Bring legacy user documents up to the shape server/index.js requires.
 *
 * WHY THIS EXISTS
 * ---------------
 * Production (MongoDB Atlas, database `test`) holds 50 users written by the legacy `chem_beo`
 * server. This repo's server expects fields that server never wrote. Inventory 2026-07-28:
 *
 *     companyId    1/50        role       1/50
 *     active       1/50        createdAt  1/50
 *     simulationTokens:  int 2 · string 1 · MISSING 47
 *
 * Deploy this repo's server against that data untouched and:
 *   - buildTenantFilter keys on companyId, so 49 users see an empty account;
 *   - chargeSimulationToken filters simulationTokens: {$gt: 0}, so 47 users get
 *     "403 No simulation tokens left" on every action;
 *   - one user breaks $inc outright, because $inc on a string is a MongoDB error.
 *
 * See docs/PRODUCTION-83-INVENTORY.md §5.
 *
 * DESIGN
 * ------
 * Idempotent: only ever fills in what is missing. It never overwrites a value that is already
 * the right type, so re-running is safe and a partial run can simply be re-run.
 *
 * Dry-run by default. It refuses to write unless --apply is passed, and --apply refuses to run
 * without --yes-i-have-a-backup, because this edits the production user collection.
 *
 * Credits are NOT invented. Users missing simulationTokens get --default-tokens, which
 * defaults to 0 rather than a free grant — see the note on that flag below.
 *
 * USAGE
 * -----
 *   node scripts/migrate-legacy-users.mjs --uri "$MONGODB_URI"                 # dry run
 *   node scripts/migrate-legacy-users.mjs --uri "$MONGODB_URI" --verbose       # per-user detail
 *   node scripts/migrate-legacy-users.mjs --uri "$MONGODB_URI" --apply --yes-i-have-a-backup
 *
 * Flags:
 *   --uri <s>             connection string. Falls back to $MONGODB_URI. Never hardcode it.
 *   --db <s>              database name. Default `test` — the production URI carries no
 *                         database name, so the driver falls back to `test` and that is where
 *                         the data actually is. Do not "fix" this without checking.
 *   --company <id>        companyId to assign. Default: the single existing company, if there
 *                         is exactly one. Fails loudly if there are several.
 *   --default-tokens <n>  balance for users with no simulationTokens field. Default 0.
 *   --apply               actually write. Otherwise prints what it would do and exits.
 *   --yes-i-have-a-backup required alongside --apply.
 *   --verbose             list every user and the changes proposed for them.
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
const DEFAULT_TOKENS = Number(opt('default-tokens', '0'));

if (!URI) {
  console.error('No connection string. Pass --uri or set MONGODB_URI.');
  process.exit(2);
}
if (APPLY && !CONFIRMED) {
  console.error('--apply requires --yes-i-have-a-backup. This edits the production users collection.');
  process.exit(2);
}
if (!Number.isFinite(DEFAULT_TOKENS) || DEFAULT_TOKENS < 0) {
  console.error('--default-tokens must be a non-negative number.');
  process.exit(2);
}

const client = new MongoClient(URI);

/** Coerce a legacy simulationTokens value to a non-negative integer, or null if unusable. */
function coerceTokens(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return null;
}

async function main() {
  await client.connect();
  const db = client.db(DB_NAME);
  const users = db.collection('users');
  const companies = db.collection('companies');

  // ── Resolve the target company ──────────────────────────────────────────
  // Every legacy user predates multi-tenancy, so they all belong to the one company that
  // exists. If that assumption ever stops holding, this must fail rather than guess: putting
  // a user in the wrong tenant exposes another tenant's data to them.
  let companyId = opt('company');
  let company;
  if (companyId) {
    company = await companies.findOne({ companyId });
    if (!company) throw new Error(`No company with companyId=${companyId}`);
  } else {
    const all = await companies.find({}).toArray();
    if (all.length === 0) {
      throw new Error('No companies exist. Create one first — this script will not invent a tenant.');
    }
    if (all.length > 1) {
      throw new Error(
        `${all.length} companies exist, so the target is ambiguous. Re-run with --company <companyId>.\n` +
        all.map((c) => `  ${c.companyId}  ${c.name}`).join('\n')
      );
    }
    company = all[0];
    companyId = company.companyId;
  }

  const companyName = company.name || null;
  console.log(`database   : ${DB_NAME}`);
  console.log(`company    : ${companyName} (${companyId})`);
  console.log(`mode       : ${APPLY ? 'APPLY — will write' : 'DRY RUN — no writes'}`);
  console.log('');

  const all = await users.find({}).toArray();
  const now = new Date();

  const stats = {
    total: all.length, untouched: 0, companyId: 0, companyName: 0,
    role: 0, active: 0, createdAt: 0, tokensCoerced: 0, tokensDefaulted: 0, unusableTokens: []
  };
  const plan = [];

  for (const u of all) {
    const set = {};

    if (u.companyId === undefined || u.companyId === null) { set.companyId = companyId; stats.companyId++; }
    if (!u.companyName) { set.companyName = companyName; stats.companyName++; }

    // Everyone becomes a member. Ownership is not inferrable from legacy data, and guessing
    // wrong hands someone admin rights over the tenant — promote deliberately afterwards.
    if (!u.role) { set.role = 'member'; stats.role++; }

    // active is checked as `{$ne: false}`, so absent already reads as active. Set it
    // explicitly anyway so the admin UI shows a real value rather than a blank.
    if (typeof u.active !== 'boolean') { set.active = true; stats.active++; }

    if (!(u.createdAt instanceof Date)) {
      // The ObjectId embeds its creation time — a real timestamp beats inventing `now`.
      set.createdAt = u._id?.getTimestamp?.() instanceof Date ? u._id.getTimestamp() : now;
      stats.createdAt++;
    }

    if (typeof u.simulationTokens !== 'number' || !Number.isFinite(u.simulationTokens)) {
      if (u.simulationTokens === undefined || u.simulationTokens === null) {
        set.simulationTokens = DEFAULT_TOKENS;
        stats.tokensDefaulted++;
      } else {
        const coerced = coerceTokens(u.simulationTokens);
        if (coerced === null) {
          // Do not silently zero a balance that might be real. Report and skip the field.
          stats.unusableTokens.push({ username: u.username, value: u.simulationTokens });
        } else {
          set.simulationTokens = coerced;
          stats.tokensCoerced++;
        }
      }
    }

    if (Object.keys(set).length === 0) { stats.untouched++; continue; }
    set.updatedAt = now;
    plan.push({ _id: u._id, username: u.username, set });
  }

  if (VERBOSE) {
    for (const p of plan) {
      console.log(`  ${p.username}: ${JSON.stringify(p.set)}`);
    }
    console.log('');
  }

  console.log(`users total                     : ${stats.total}`);
  console.log(`already correct, untouched      : ${stats.untouched}`);
  console.log(`to change                       : ${plan.length}`);
  console.log(`  + companyId                   : ${stats.companyId}`);
  console.log(`  + companyName                 : ${stats.companyName}`);
  console.log(`  + role=member                 : ${stats.role}`);
  console.log(`  + active=true                 : ${stats.active}`);
  console.log(`  + createdAt (from ObjectId)   : ${stats.createdAt}`);
  console.log(`  simulationTokens coerced      : ${stats.tokensCoerced}`);
  console.log(`  simulationTokens set to ${String(DEFAULT_TOKENS).padEnd(6)}: ${stats.tokensDefaulted}`);

  if (stats.unusableTokens.length) {
    console.log('');
    console.log('UNUSABLE simulationTokens — left untouched, fix by hand:');
    for (const r of stats.unusableTokens) console.log(`  ${r.username}: ${JSON.stringify(r.value)}`);
  }

  if (!APPLY) {
    console.log('');
    console.log('Dry run. Nothing written. Re-run with --apply --yes-i-have-a-backup to write.');
    return;
  }

  let written = 0;
  for (const p of plan) {
    const r = await users.updateOne({ _id: p._id }, { $set: p.set });
    written += r.modifiedCount;
  }
  console.log('');
  console.log(`WROTE ${written} documents.`);

  // ── Verify, do not assume ───────────────────────────────────────────────
  // This is the exact check runbook 0.10 gates the cutover on.
  const remaining = await users.countDocuments({ companyId: { $exists: false } });
  const badTokens = await users.countDocuments({
    $or: [{ simulationTokens: { $exists: false } }, { simulationTokens: { $type: 'string' } }]
  });
  console.log('');
  console.log(`VERIFY users without companyId  : ${remaining}   (runbook 0.10 requires 0)`);
  console.log(`VERIFY users with bad tokens    : ${badTokens}   (requires 0)`);
  if (remaining !== 0 || badTokens !== 0) {
    console.error('\nVERIFICATION FAILED. Do not cut over. Investigate before re-running.');
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; })
  .finally(() => client.close());
