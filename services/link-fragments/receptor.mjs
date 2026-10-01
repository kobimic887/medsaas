// Rigid excluded volume for full linker searches. No affinity/energy estimate.
import { createHash } from 'node:crypto';
import { LinkFragmentsError } from './sdf.mjs';
export const RECEPTOR_LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, atoms: 100000, frameDistance: 8, fragmentOverlap: 1.2, clashOverlap: 0.6, severeOverlap: 1.2, cell: 5, coordinate: 1000000 });
const RADII = Object.freeze({ C: 1.7, N: 1.55, O: 1.52, F: 1.47, P: 1.8, S: 1.8, Cl: 1.75, Br: 1.85, I: 1.98, Se: 1.9, Si: 2.1, B: 1.92, Na: 2.27, K: 2.75, Mg: 1.73, Zn: 1.39, Cu: 1.4, Ni: 1.63, Li: 1.82 });
const WATERS = new Set(['HOH', 'WAT', 'DOD', 'H2O', 'TIP', 'TIP3', 'SOL']);
const H = new Set(['H', 'D', 'T']);
const TWO_LETTER = new Set(['CL', 'BR', 'NA', 'MG', 'ZN', 'FE', 'CA', 'MN', 'CU', 'NI', 'CO', 'SE', 'LI', 'CD', 'HG', 'SR', 'BA', 'CS', 'RB', 'AL', 'SI', 'PT', 'AU', 'AG', 'PB', 'SN']);
const refuse = (code, message, details) => { throw new LinkFragmentsError(code, message, details); };
const cellKey = (x, y, z) => `${x},${y},${z}`;
function inferredElement(name, record) {
  const raw = name.toUpperCase();
  if (record === 'HETATM' && /^[A-Z]/.test(raw) && TWO_LETTER.has(raw.slice(0, 2))) return raw.slice(0, 2)[0] + raw.slice(0, 2)[1].toLowerCase();
  return raw.trim().replace(/[^A-Z]/g, '').slice(0, 1);
}
export function parseReceptor(text) {
  if (typeof text !== 'string' || !text.trim()) refuse('RECEPTOR_INVALID', 'Supply receptor PDB text.');
  if (Buffer.byteLength(text, 'utf8') > RECEPTOR_LIMITS.bytes) refuse('RECEPTOR_TOO_LARGE', 'Receptor PDB must be 5 MB or smaller.');
  const atoms = [], hets = new Map(), altChosen = new Map(), warnings = [];
  let atomsRead = 0, watersRemoved = 0, hydrogensRemoved = 0, alternates = 0, models = 0;
  for (const [i, line] of text.replace(/\r/g, '').split('\n').entries()) {
    const record = line.slice(0, 6).trim();
    if (record === 'MODEL') { if (++models > 1) break; continue; }
    if (record === 'ENDMDL' && models) break;
    if (record !== 'ATOM' && record !== 'HETATM') continue;
    if (++atomsRead > RECEPTOR_LIMITS.atoms) refuse('RECEPTOR_TOO_LARGE', 'Receptor PDB has more than 100000 atoms.');
    // Number('') is zero; require numeric text rather than manufacturing coordinates.
    const fields = [line.slice(30, 38), line.slice(38, 46), line.slice(46, 54)];
    const xyz = fields.map(Number);
    if (fields.some((v) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim())) || !xyz.every((v) => Number.isFinite(v) && Math.abs(v) <= RECEPTOR_LIMITS.coordinate)) refuse('RECEPTOR_INVALID', `PDB line ${i + 1} has unreadable coordinates.`);
    const residue = line.slice(17, 20).trim(), chain = line.slice(21, 22).trim(), number = line.slice(22, 27).trim(), name = line.slice(12, 16), alt = line.slice(16, 17).trim();
    const raw = line.slice(76, 78).trim();
    const element = /^[A-Za-z]+$/.test(raw) ? raw[0].toUpperCase() + raw.slice(1).toLowerCase() : inferredElement(name, record);
    const key = `${chain}:${number}:${residue}`;
    if (alt) { if (!altChosen.has(key)) altChosen.set(key, alt); if (altChosen.get(key) !== alt) { alternates++; continue; } }
    if (WATERS.has(residue.toUpperCase())) { watersRemoved++; continue; }
    if (H.has(element)) { hydrogensRemoved++; continue; }
    // Search refuses an unknown radius instead of silently substituting one.
    if (!RADII[element]) refuse('RECEPTOR_UNSUPPORTED_ELEMENT', `PDB line ${i + 1}: excluded-volume radius for ${element || 'unknown element'} is not supported.`, { element, line: i + 1 });
    if (record === 'HETATM') { const group = hets.get(key) || { residue, chain, number, atoms: 0 }; group.atoms++; hets.set(key, group); }
    atoms.push({ element, xyz, radius: RADII[element] });
  }
  if (!atomsRead) refuse('RECEPTOR_INVALID', 'Receptor PDB contains no ATOM or HETATM records.');
  if (!atoms.length) refuse('RECEPTOR_EMPTY', 'Receptor PDB has no heavy atoms after removing hydrogens and waters.');
  if (models) warnings.push('Only the first MODEL was used.');
  if (alternates) warnings.push(`${alternates} alternate-location atoms ignored; the first alternate of each residue was used.`);
  const hetGroups = [...hets.values()];
  if (hetGroups.length) warnings.push('HET groups are retained as excluded volume. Remove bound ligands; required cofactors can remain.');
  const buckets = Object.create(null);
  atoms.forEach((atom, i) => { const key = cellKey(...atom.xyz.map((v) => Math.floor(v / RECEPTOR_LIMITS.cell))); (buckets[key] ||= []).push(i); });
  return { atoms, buckets, report: { heavyAtoms: atoms.length, atomsRead, watersRemoved, hydrogensRemoved, hetGroups, warnings, sha256: createHash('sha256').update(text).digest('hex'), screeningDuringSearch: true, clashOverlap: RECEPTOR_LIMITS.clashOverlap, severeOverlap: RECEPTOR_LIMITS.severeOverlap, method: 'Rigid heavy-atom excluded volume; clashes rank candidates, without affinity scoring.' } };
}
function eachNearby(context, xyz, reach, visit) {
  // A finite number can still be too large for x++ to advance; bound before
  // grid loops so malformed coordinates cannot hang a worker or HTTP inspect.
  if (!Array.isArray(xyz) || xyz.length !== 3 || !xyz.every((v) => Number.isFinite(v) && Math.abs(v) <= RECEPTOR_LIMITS.coordinate)) refuse('RECEPTOR_INVALID_QUERY', 'Coordinates must be finite and within ±1000000 Å.');
  const low = xyz.map((v) => Math.floor((v - reach) / RECEPTOR_LIMITS.cell)), high = xyz.map((v) => Math.floor((v + reach) / RECEPTOR_LIMITS.cell));
  for (let x = low[0]; x <= high[0]; x++) for (let y = low[1]; y <= high[1]; y++) for (let z = low[2]; z <= high[2]; z++) {
    const bucket = context.buckets[cellKey(x, y, z)];
    if (bucket) for (const index of bucket) visit(context.atoms[index]);
  }
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function inspectReceptor(text, fragments) {
  try {
    const context = parseReceptor(text), query = (Array.isArray(fragments) ? fragments : fragments?.fragments)?.flatMap((m) => m.atoms).filter((a) => !H.has(a.element));
    if (!query?.length) refuse('RECEPTOR_INVALID_QUERY', 'Inspect a valid two-fragment query before checking the receptor.');
    let minimum = Infinity;
    for (const atom of query) eachNearby(context, atom.xyz, RECEPTOR_LIMITS.frameDistance, (r) => { minimum = Math.min(minimum, distance(atom.xyz, r.xyz)); });
    if (minimum < RECEPTOR_LIMITS.fragmentOverlap) refuse('RECEPTOR_FRAGMENT_OVERLAP', 'The receptor overlaps the fixed fragments within 1.2 Å. Remove the bound ligand and use the same coordinate frame.', { minHeavyDistance: minimum });
    if (minimum > RECEPTOR_LIMITS.frameDistance) refuse('RECEPTOR_FRAME', 'No receptor heavy atom lies within 8 Å of the uploaded fragments. Use a ligand-free receptor in the same coordinate frame; uploading a different PDB does not align or dock the fragments.');
    context.fixedScore = scoreReceptor(context, query);
    const report = { ...context.report, minFragmentDistance: minimum, fixedFragmentClashes: context.fixedScore.clashes, fixedFragmentSevereClashes: context.fixedScore.severeClashes };
    return { ok: true, report, context };
  } catch (e) { return { ok: false, errors: [e instanceof LinkFragmentsError ? e.toJSON() : { code: 'RECEPTOR_INVALID', message: 'Receptor could not be inspected.' }] }; }
}
/** Scores receptor/product heavy-atom PAIRS, not atom count or energy. */
export function scoreReceptor(context, atoms, initial = null) {
  const score = { clashes: initial?.clashes || 0, severeClashes: initial?.severeClashes || 0, overlapSquared: initial?.overlapSquared || 0, maxOverlap: initial?.maxOverlap || 0, clashOverlap: RECEPTOR_LIMITS.clashOverlap, severeOverlap: RECEPTOR_LIMITS.severeOverlap };
  for (const atom of atoms) {
    if (H.has(atom.element) || atom.element === 'He') continue;
    const radius = RADII[atom.element];
    if (!radius) refuse('RECEPTOR_UNSUPPORTED_ELEMENT', `Excluded-volume radius for product element ${atom.element} is not supported.`);
    eachNearby(context, atom.xyz, radius + 2.75, (r) => {
      const overlap = radius + r.radius - distance(atom.xyz, r.xyz);
      score.maxOverlap = Math.max(score.maxOverlap, overlap);
      if (overlap >= RECEPTOR_LIMITS.clashOverlap) { score.clashes++; score.overlapSquared += overlap * overlap; }
      if (overlap >= RECEPTOR_LIMITS.severeOverlap) score.severeClashes++;
    });
  }
  return score;
}
export function compareReceptorScores(a, b) {
  if (!a || !b) return 0;
  return a.severeClashes - b.severeClashes || a.overlapSquared - b.overlapSquared || a.clashes - b.clashes;
}
