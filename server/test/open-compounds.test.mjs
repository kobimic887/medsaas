// Open-compounds unit tests: validation, Morgan re-score, CSV/SDF, ChEMBL mapping.
// Run: SERVER_RUNTIME=bun bun test/open-compounds.test.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildChemblSimilarityUrl,
  buildOpenCompoundsStatus,
  chemblMoleculeToCandidate,
  morganDetailsJson,
  openCompoundsConfig,
  OPEN_COMPOUNDS_FINGERPRINT,
  parseOpenCompoundsQuery,
  OpenCompoundsValidationError,
  rescoreAndRank,
  resultsToCsv,
  resultsToSdf,
  tanimotoUint8,
  validateAndFingerprint,
  loadRDKit,
  resetRDKitForTests,
  fetchChemblCandidates,
} from '../utils/openCompounds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

const REF = 'c1ccc2c(c1)nc(s2)SCC(=O)O';

console.log('[open-compounds] config + query validation');
{
  const cfg = openCompoundsConfig({});
  check('default base is ChEMBL', cfg.baseUrl.includes('ebi.ac.uk/chembl'));
  check('enabled by default', cfg.enabled === true);
  check('AI off without keys', cfg.ai.enabled === false);
  check('AI stays unavailable until implemented even with settings', openCompoundsConfig({ OPEN_COMPOUNDS_AI_ENABLED: 'true', OPEN_COMPOUNDS_AI_PROVIDER: 'fixture', OPEN_COMPOUNDS_AI_MODEL: 'fixture', OPEN_COMPOUNDS_AI_API_KEY: 'fixture' }).ai.enabled === false);

  const disabled = openCompoundsConfig({ OPEN_COMPOUNDS_ENABLED: 'false' });
  check('can disable open compounds', disabled.enabled === false);

  const status = buildOpenCompoundsStatus(cfg);
  check('status declares Morgan fingerprint', status.fingerprint.radius === 2 && status.fingerprint.nBits === 2048);
  check('status warns query leaves the premises', status.sendsQueryExternally === true);

  try {
    parseOpenCompoundsQuery({});
    check('missing smiles rejected', false);
  } catch (e) {
    check('missing smiles rejected', e instanceof OpenCompoundsValidationError);
  }
  try {
    parseOpenCompoundsQuery({ smiles: REF, threshold: '0.2' });
    check('threshold below ChEMBL floor rejected', false);
  } catch (e) {
    check('threshold below ChEMBL floor rejected', e instanceof OpenCompoundsValidationError);
  }
  const ok = parseOpenCompoundsQuery({ smiles: REF, threshold: '0.7', maxResults: '100', limit: '20' });
  check('parses reference query', ok.smiles === REF && ok.threshold === 0.7 && ok.maxResults === 100);
}

console.log('[open-compounds] ChEMBL URL + molecule mapping');
{
  const url = buildChemblSimilarityUrl({
    baseUrl: 'https://www.ebi.ac.uk/chembl/api/data',
    smiles: REF,
    thresholdPercent: 70,
    offset: 0,
    limit: 10,
  });
  check('similarity URL encodes SMILES', url.includes('/similarity/') && url.includes('/70?'));
  check('URL asks for json', url.includes('format=json'));

  const candidate = chemblMoleculeToCandidate({
    molecule_chembl_id: 'CHEMBL1373993',
    similarity: '100',
    molecule_structures: {
      canonical_smiles: 'O=C(O)CSc1nc2ccccc2s1',
      standard_inchi_key: 'ZZUQWNYNSKJLPI-UHFFFAOYSA-N',
    },
  });
  check('maps ChEMBL id + smiles + inchikey', candidate.chemblId === 'CHEMBL1373993' && candidate.inchiKey.startsWith('ZZUQ'));
  check('rejects molecule without smiles', chemblMoleculeToCandidate({ molecule_chembl_id: 'X' }) === null);
}

console.log('[open-compounds] RDKit Morgan re-score (reference query)');
{
  resetRDKitForTests();
  const RDKit = await loadRDKit();
  const details = morganDetailsJson();
  const query = validateAndFingerprint(RDKit, REF, details);
  check('reference query parses', Boolean(query?.smiles));

  const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/open-chembl-reference-70.json'), 'utf8'));
  const candidates = fixture.molecules.map(chemblMoleculeToCandidate).filter(Boolean);
  const ranked = rescoreAndRank({
    RDKit,
    querySmiles: REF,
    candidates,
    threshold: 0.7,
    maxResults: 100,
  });
  check('returns all six ChEMBL hits at 0.7', ranked.results.length === 6);
  check('top hit is self / CHEMBL1373993', ranked.results[0].chemblId === 'CHEMBL1373993' && ranked.results[0].similarity === 1);
  check('all scores meet threshold', ranked.results.every((r) => r.similarity >= 0.7));
  check('scores are deterministic ranks', ranked.results.every((r, i) => r.rank === i + 1));

  // Independently recompute first three scores
  for (const row of ranked.results.slice(0, 3)) {
    const hit = validateAndFingerprint(RDKit, row.smiles, details);
    const t = tanimotoUint8(query.fpUint8, hit.fpUint8);
    check(`recomputed score matches ${row.chemblId}`, Math.abs(t - row.similarity) < 1e-9, `${t} vs ${row.similarity}`);
  }

  // Match ChEMBL-reported percentages (measured 2026-09-09 — same FP)
  for (const mol of fixture.molecules) {
    const cand = chemblMoleculeToCandidate(mol);
    const hit = validateAndFingerprint(RDKit, cand.smiles, details);
    const t = tanimotoUint8(query.fpUint8, hit.fpUint8);
    const chembl = Number(mol.similarity) / 100;
    check(`local score matches ChEMBL % for ${cand.chemblId}`, Math.abs(t - chembl) < 1e-6);
  }

  const filtered = rescoreAndRank({
    RDKit,
    querySmiles: REF,
    candidates,
    threshold: 0.8,
    maxResults: 100,
  });
  check('threshold 0.8 keeps only exact match', filtered.results.length === 1 && filtered.results[0].similarity === 1);

  const csv = resultsToCsv({
    querySmiles: ranked.querySmilesCanonical,
    threshold: 0.7,
    results: ranked.results,
  });
  check('CSV includes chembl id and fingerprint settings', csv.includes('CHEMBL1373993') && csv.includes('morgan') && csv.includes('2048'));

  const sdf = resultsToSdf(ranked.results.map((r) => ({
    ...r,
    molblock: validateAndFingerprint(RDKit, r.smiles, details).molblock,
  })));
  check('SDF contains mol terminators and provenance', (sdf.match(/\$\$\$\$/g) || []).length === 6 && sdf.includes('DOCKING_READY') && sdf.includes('false'));
  check('SDF refuses to claim docking-ready', /DOCKING_READY>\nfalse/.test(sdf));
}

console.log('[open-compounds] fetchChemblCandidates stub');
{
  const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/open-chembl-reference-70.json'), 'utf8'));
  const { candidates, retrieval } = await fetchChemblCandidates({
    baseUrl: 'https://chembl.test/api/data',
    smiles: REF,
    threshold: 0.7,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(fixture),
    }),
  });
  check('stub returns six candidates', candidates.length === 6);
  check('retrieval note is honest about ranking scope', /retrieved candidates/i.test(retrieval.rankingNote));
  check('fingerprint declaration constant is frozen', Object.isFrozen(OPEN_COMPOUNDS_FINGERPRINT));
}

console.log(`\n[open-compounds] ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
