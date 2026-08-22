#!/usr/bin/env node
/**
 * Does a candidate docking engine's response actually reach the user's screen?
 *
 * WHY THIS EXISTS
 * ---------------
 * The box replaces one HTTP call: POST {dockingApiUrl} -> { pdb, sdf }. Getting that payload
 * "chemically right" is not enough. Between the engine and the visualiser sit two parsers, and
 * they disagree about how strict to be:
 *
 *   1. SERVER  GET /api/sanitizedminimalsdf/:key   (server/index.js:3359)
 *      Matches property tags with an EXACT string:  line.startsWith('>  <smiles>')
 *      Two spaces. Case-sensitive. A block with no `<smiles>` match is DROPPED.
 *      Then it de-duplicates by SMILES value, keeping the lowest SCORE.
 *
 *   2. CLIENT  parseSdfData()                      (client/.../molstar3d.jsx:17)
 *      Matches with a regex, /<([^>]+)>/, so spacing does not matter here.
 *
 * The asymmetry is the trap. Emit `> <smiles>` with ONE space and the client parser would cope
 * fine — but it never gets the chance, because the server parser matched nothing, built an
 * empty reduction, and returned **HTTP 200** with a body of just "\n$$$$\n".
 *
 * The user sees: the dock succeeds, a credit is spent, the receptor renders in Molstar, and the
 * ligand table is empty. No score, no poses, no error, nothing in any log. It looks like the
 * box "worked".
 *
 * So this script runs a candidate payload through BOTH parsers, byte-for-byte the same logic as
 * production, and reports what the dashboard would actually display.
 *
 * USAGE
 * -----
 *   # against a saved payload  {"pdb": "...", "sdf": "..."}
 *   node scripts/verify-docking-response.mjs --file candidate.json
 *
 *   # against a live engine (the box, or Asinex, to capture the reference)
 *   node scripts/verify-docking-response.mjs \
 *     --url http://<box>:8000/docking --pdbid 1cx7 --smiles 'c1ccc2c(c1)nc(o2)SCC(=O)O'
 *
 *   # compare a candidate against a known-good reference
 *   node scripts/verify-docking-response.mjs --file candidate.json --baseline reference.json
 *
 * Exit code 0 = the dashboard would render poses and scores. Non-zero = it would not.
 * See docs/DOCKING-CONTRACT.md.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const FILE = opt('file');
const URL_ = opt('url');
const PDBID = opt('pdbid', '1cx7');
const SMILES = opt('smiles', 'c1ccc2c(c1)nc(o2)SCC(=O)O');
const BASELINE = opt('baseline');
const SAVE = opt('save');
const TIMEOUT_MS = Number(opt('timeout', '600000')); // matches EXTERNAL_HTTP_TIMEOUT_LONG_MS

const problems = [];
const warnings = [];
const fail = (m) => problems.push(m);
const warn = (m) => warnings.push(m);

// ── The two parsers, copied verbatim from production ────────────────────────

/**
 * server/index.js:3359 — GET /api/sanitizedminimalsdf/:simulationKey.
 * Do not "clean this up". Its brittleness IS the thing being tested; a tolerant
 * reimplementation here would pass payloads that production silently drops.
 */
function serverReduce(sdf) {
  const sdfBlocks = sdf.split('$$$$');
  const smilesMap = {};
  for (const block of sdfBlocks) {
    const lines = block.split('\n');
    let smiles = null;
    let score = null;
    lines.forEach((line) => {
      if (line.startsWith('>  <smiles>')) {
        smiles = lines[lines.indexOf(line) + 1]?.trim();
      }
      if (line.startsWith('>  <SCORE>')) {
        score = parseFloat(lines[lines.indexOf(line) + 1]?.trim());
      }
    });
    if (smiles) {
      if (!(smiles in smilesMap) || (score !== null && score < smilesMap[smiles].score)) {
        smilesMap[smiles] = { block, score };
      }
    }
  }
  const reduced =
    Object.values(smilesMap)
      .map((o) => o.block.trim())
      .join('\n$$$$\n') + '\n$$$$\n';
  return { reduced: reduced.replace(/\n/g, '\r\n'), kept: Object.keys(smilesMap).length };
}

/** client/src/pages/dashboard/molstar3d.jsx:17 — parseSdfData(). Also verbatim. */
function clientParse(sdfText) {
  const molecules = sdfText.split('$$$$').filter((e) => e.trim());
  return molecules.map((molecule, index) => {
    const lines = molecule.split('\n');
    const properties = {};
    let currentProperty = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('>') && line.includes('<') && line.includes('>')) {
        const match = line.match(/<([^>]+)>/);
        if (match) currentProperty = match[1];
      } else if (currentProperty && line && !line.startsWith('>')) {
        properties[currentProperty] = line;
        currentProperty = null;
      }
    }
    return {
      id: index + 1,
      name: lines[0]?.trim() || `Molecule ${index + 1}`,
      model: properties.MODEL || 'N/A',
      torsdo: properties.TORSDO || 'N/A',
      score: properties.SCORE || 'N/A',
      ligand_id: properties.ligand_id || 'N/A',
      original_smiles: properties.original_smiles || 'N/A',
      smiles: properties.smiles || 'N/A'
    };
  });
}

// ── Fetch or load the payload ───────────────────────────────────────────────

async function getPayload() {
  if (FILE) return JSON.parse(readFileSync(FILE, 'utf8'));
  if (!URL_) {
    console.error('Need --file <candidate.json> or --url <dockingApiUrl>. See --help in the header.');
    process.exit(2);
  }
  // Exactly the request server/index.js:3191 makes. `pdbID` is capital-D on purpose,
  // and SMILES goes out URL-encoded — see DOCKING-CONTRACT.md §0.
  const body = JSON.stringify({
    pdbID: PDBID,
    smiles: SMILES === decodeURIComponent(SMILES) ? encodeURIComponent(SMILES) : SMILES
  });
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(URL_, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body,
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(timer);
  }
  const elapsed = Date.now() - started;
  console.log(`request   : POST ${URL_}`);
  console.log(`body      : ${body.slice(0, 120)}${body.length > 120 ? '…' : ''}`);
  console.log(`status    : ${res.status}`);
  console.log(`elapsed   : ${(elapsed / 1000).toFixed(1)}s of ${(TIMEOUT_MS / 1000).toFixed(0)}s budget`);
  if (elapsed > TIMEOUT_MS * 0.8) {
    warn(`Took ${(elapsed / 1000).toFixed(0)}s — over 80% of the platform's timeout. Past it the user is refunded and sees 502.`);
  }
  if (!res.ok) {
    // This is what the platform does: any non-2xx becomes a refund and a 502.
    fail(`Engine returned ${res.status}. The platform treats this as an outage: credit refunded, user sees 502.`);
    console.log('');
    report();
    process.exit(1);
  }
  return res.json();
}

// ── Checks ──────────────────────────────────────────────────────────────────

function checkEnvelope(payload) {
  if (payload === null || typeof payload !== 'object') {
    fail('Response is not a JSON object.');
    return false;
  }
  let ok = true;
  for (const k of ['pdb', 'sdf']) {
    if (typeof payload[k] !== 'string' || payload[k].length === 0) {
      // Both sanitized endpoints guard on `existing.result.<k>` being truthy, and 404 otherwise.
      fail(`result.${k} is missing or not a non-empty string. /api/sanitized* returns 404 and the viewer shows nothing.`);
      ok = false;
    }
  }
  const extra = Object.keys(payload).filter((k) => !['pdb', 'sdf'].includes(k));
  if (extra.length) {
    // Harmless — the handler spreads the whole object into the response — but worth seeing,
    // because `simulationKey` is added by the platform and must not come from the engine.
    warn(`Extra top-level keys returned: ${extra.join(', ')}. Not fatal. Note the platform adds simulationKey itself — an engine-supplied one is overwritten.`);
  }
  return ok;
}

function checkPdb(pdb) {
  const lines = pdb.split('\n');
  const atoms = lines.filter((l) => l.startsWith('ATOM') || l.startsWith('HETATM'));
  const hydrogens = atoms.filter((l) => l.slice(76, 78).trim() === 'H' || /\s[H]\d*\s*$/.test(l));
  const chains = new Set(atoms.map((l) => l[21]).filter((c) => c && c !== ' '));
  console.log(`  atoms          : ${atoms.length}`);
  console.log(`  hydrogens      : ${hydrogens.length}`);
  console.log(`  chains         : ${[...chains].join(', ') || '(none)'}`);
  console.log(`  TER / END      : ${lines.some((l) => l.startsWith('TER')) ? 'yes' : 'NO'} / ${lines.some((l) => l.trim() === 'END') ? 'yes' : 'NO'}`);
  console.log(`  size           : ${(pdb.length / 1024).toFixed(0)} KB`);

  if (atoms.length === 0) fail('result.pdb contains no ATOM/HETATM records. Molstar renders an empty scene.');
  if (hydrogens.length === 0) {
    warn('No hydrogens found. The reference receptor is protonated (DOCKING-CONTRACT §2) — not fatal for rendering, but it means the preparation step differs.');
  }
  if (!lines.some((l) => l.trim() === 'END')) {
    warn('No END record. Some parsers tolerate this; the reference has one.');
  }
  // Deliberately NOT checked: byte-equality against a previous run. The reference
  // re-protonates every dock and its hydrogens move — DOCKING-CONTRACT §2.
}

function checkSdf(sdf) {
  const rawBlocks = sdf.split('$$$$').filter((b) => b.trim());
  console.log(`  poses in       : ${rawBlocks.length}`);

  // The exact-string tag check, which is the whole point of this script.
  const strictSmiles = (sdf.match(/^> {2}<smiles>/gm) || []).length;
  const strictScore = (sdf.match(/^> {2}<SCORE>/gm) || []).length;
  const looseSmiles = (sdf.match(/^>\s*<smiles>/gm) || []).length;
  const looseScore = (sdf.match(/^>\s*<SCORE>/gm) || []).length;

  console.log(`  '>  <smiles>'  : ${strictSmiles} exact  (${looseSmiles} with any spacing)`);
  console.log(`  '>  <SCORE>'   : ${strictScore} exact  (${looseScore} with any spacing)`);

  if (strictSmiles === 0 && looseSmiles > 0) {
    fail(
      `Tag spacing is wrong. Found ${looseSmiles} <smiles> tags, but 0 match the server's exact ` +
      `'>  <smiles>' (TWO spaces). server/index.js:3372 drops every block, returns HTTP 200 with an ` +
      `empty SDF, and the viewer shows the protein with no ligands and no score. Silent.`
    );
  }
  if (strictSmiles === 0 && looseSmiles === 0) {
    fail("No <smiles> property tag at all. The server keys its de-duplication on it, so every pose is dropped. Viewer shows no ligands.");
  }
  if (strictScore === 0) {
    fail("No exact '>  <SCORE>' tag (TWO spaces, uppercase). The score column reads 'N/A' and pose ordering is meaningless.");
  }
  if (/^>\s*<(Smiles|SMILES)>/m.test(sdf)) {
    fail("Found <Smiles> or <SMILES>. The server matches lowercase '<smiles>' only. Case matters.");
  }
  if (!/RDKit/.test(sdf)) {
    warn('No RDKit writer line. The reference is RDKit-written (DOCKING-CONTRACT §3). Not fatal if the format is otherwise V2000.');
  }
  if (!/V2000/.test(sdf)) warn('No V2000 marker found. The reference is V2000.');

  return rawBlocks.length;
}

function checkPipeline(sdf, posesIn) {
  const { reduced, kept } = serverReduce(sdf);
  const shown = clientParse(reduced);

  console.log('');
  console.log('  ── what the dashboard actually shows ──');
  console.log(`  after server reduction : ${kept} pose(s)`);
  console.log(`  rows in the viewer     : ${shown.length}`);

  if (shown.length === 0) {
    fail('The viewer would list ZERO ligands. The dock appears to succeed, a credit is spent, and nothing renders.');
    return;
  }

  // The reference collapses 5 poses to 1: all poses of one ligand share a <smiles>,
  // and the server keeps only the best-scoring block per distinct SMILES.
  if (posesIn > 1 && kept === posesIn) {
    warn(
      `${posesIn} poses in and ${kept} kept — no de-duplication happened, so each pose carries a ` +
      `DIFFERENT <smiles>. The reference emits one <smiles> for all poses of a ligand and collapses ` +
      `to the best-scoring one. The user will see ${kept} rows where production shows 1.`
    );
  }

  const table = shown
    .map((m) => ({ ...m, n: parseFloat(m.score) }))
    .sort((a, b) => a.n - b.n); // molstar3d.jsx:975 — most negative first

  for (const m of table) {
    const bucket = m.n < -7 ? 'green' : m.n < -5 ? 'amber' : 'red'; // molstar3d.jsx:980
    const badge = Number.isFinite(m.n) ? `${m.score}  [${bucket}]` : `${m.score}  ← NOT A NUMBER`;
    console.log(`    ${m.name.padEnd(10)} SCORE ${badge}`);
    console.log(`      MODEL=${m.model}  TORSDO=${m.torsdo}  ligand_id=${m.ligand_id}`);
  }

  const unparseable = table.filter((m) => !Number.isFinite(m.n));
  if (unparseable.length) {
    fail(`${unparseable.length} pose(s) have a SCORE that is not a number. The badge shows 'N/A' and sorting breaks.`);
  }
  const positive = table.filter((m) => Number.isFinite(m.n) && m.n > 0);
  if (positive.length) {
    warn(`${positive.length} pose(s) have a POSITIVE score. AutoDock binding affinities are negative; the reference range is about -4.3 to -4.6. The UI colours anything >= -5 red.`);
  }
  for (const tag of ['MODEL', 'TORSDO', 'ligand_id', 'original_smiles']) {
    const missing = shown.filter((m) => m[tag.toLowerCase()] === 'N/A' && m[tag] === undefined);
    if (shown.some((m) => (m[tag] ?? m[tag.toLowerCase()]) === 'N/A')) {
      warn(`Property <${tag}> is missing — the viewer shows 'N/A' for it.`);
    }
    void missing;
  }
}

function compareBaseline(payload) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const a = clientParse(serverReduce(base.sdf).reduced);
  const b = clientParse(serverReduce(payload.sdf).reduced);
  console.log('');
  console.log(`  ── vs baseline ${BASELINE} ──`);
  console.log(`  baseline rows : ${a.length}   candidate rows : ${b.length}`);
  const ka = new Set(a.flatMap((m) => Object.keys(m)));
  const kb = new Set(b.flatMap((m) => Object.keys(m)));
  const onlyA = [...ka].filter((k) => !kb.has(k));
  if (onlyA.length) fail(`Baseline exposes properties the candidate does not: ${onlyA.join(', ')}`);
  const sa = a.map((m) => parseFloat(m.score)).filter(Number.isFinite);
  const sb = b.map((m) => parseFloat(m.score)).filter(Number.isFinite);
  if (sa.length && sb.length) {
    const r = (v) => `${Math.min(...v).toFixed(3)} … ${Math.max(...v).toFixed(3)}`;
    console.log(`  baseline score: ${r(sa)}`);
    console.log(`  candidate     : ${r(sb)}`);
    console.log('  Score parity is NOT required — different engines and builds differ (DOCKING-CONTRACT §6).');
    console.log('  Field names and structure ARE required, and are checked above.');
  }
}

function report() {
  if (warnings.length) {
    console.log('');
    console.log(`WARNINGS (${warnings.length}) — the dashboard still works, but something differs:`);
    for (const w of warnings) console.log(`  ! ${w}`);
  }
  console.log('');
  if (problems.length === 0) {
    console.log('PASS — the receptor renders and the pose table populates with numeric scores.');
    console.log('       This checks the PLUMBING, not the chemistry. Compare scores against the');
    console.log('       stored reference docks before trusting a new engine build.');
  } else {
    console.log(`FAIL (${problems.length}) — this payload would not reach the user correctly:`);
    for (const p of problems) console.log(`  ✗ ${p}`);
  }
}

const payload = await getPayload();
if (SAVE) {
  writeFileSync(SAVE, JSON.stringify(payload, null, 2));
  console.log(`saved     : ${SAVE}`);
}
console.log('');
if (checkEnvelope(payload)) {
  console.log('result.pdb');
  checkPdb(payload.pdb);
  console.log('');
  console.log('result.sdf');
  const posesIn = checkSdf(payload.sdf);
  checkPipeline(payload.sdf, posesIn);
  if (BASELINE) compareBaseline(payload);
}
report();
process.exit(problems.length ? 1 : 0);
