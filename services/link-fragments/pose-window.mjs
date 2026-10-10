// Optional pose diversity: atom correspondence is a chemical graph isomorphism,
// with isotope/charge/CIP stereo preserved. Coordinates stay in the uploaded frame;
// there is deliberately no superposition that could erase receptor-relative poses.
import { Database } from 'bun:sqlite';
import { deflateSync, inflateSync } from 'node:zlib';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export function heavyGraph(json) {
  const m = json.molecules[0], defaults = json.defaults;
  const cip = new Map(m.extensions?.find(e => e.name === 'rdkitRepresentation')?.cipCodes || []);
  const aromatic = new Set(m.extensions?.find(e => e.name === 'rdkitRepresentation')?.aromaticBonds || []);
  const indices = m.atoms.map((a, i) => ({ ...defaults.atom, ...a, original: i })).filter(a => a.z !== 1);
  const renumber = new Map(indices.map((a, i) => [a.original, i]));
  const atoms = indices.map(a => [a.z, a.chg, a.isotope, a.nRad, cip.get(a.original) || '', a.impHs + m.bonds.filter(b => b.atoms.includes(a.original) && (m.atoms[b.atoms.find(i => i !== a.original)].z ?? defaults.atom.z) === 1).length]);
  const bonds = m.bonds.flatMap((b, i) => renumber.has(b.atoms[0]) && renumber.has(b.atoms[1]) ? [{
    a: renumber.get(b.atoms[0]), b: renumber.get(b.atoms[1]),
    order: aromatic.has(i) ? 1.5 : (b.bo ?? defaults.bond.bo),
    stereo: b.stereo || 'unspecified', stereoAtoms: b.stereoAtoms?.map(a => renumber.get(a)),
  }] : []);
  return { atoms, bonds, coords: m.conformers?.[0]?.coords && indices.map(a => m.conformers[0].coords[a.original]) };
}

// Exhaustive symmetry search with a hard work bound. Exhausting it fails the
// optional search explicitly; it never silently accepts an incomplete mapping.
export function atomMapping(a, b, { maxSquared = Infinity, nodeLimit = 200_000 } = {}) {
  if (a.atoms.length !== b.atoms.length || a.bonds.length !== b.bonds.length) return null;
  const n = a.atoms.length, adj = g => {
    const edges = Array.from({ length: n }, () => new Map());
    for (const bond of g.bonds) { edges[bond.a].set(bond.b, bond); edges[bond.b].set(bond.a, bond); }
    return edges;
  }, aa = adj(a), bb = adj(b), map = Array(n).fill(-1), used = new Set();
  const labels = g => g.atoms.map((v, i) => JSON.stringify(v) + ':' + (g === a ? aa : bb)[i].size);
  const la = labels(a), lb = labels(b);
  const candidates = la.map(label => lb.flatMap((other, i) => other === label ? [i] : []));
  if (candidates.some(c => !c.length)) return null;
  const order = [...map.keys()].sort((x, y) => candidates[x].length - candidates[y].length || aa[y].size - aa[x].size || x - y);
  let visits = 0;
  const stereoValid = () => a.bonds.every(bond => {
    const other = bb[map[bond.a]].get(map[bond.b]);
    if (bond.stereo === 'unspecified' && other.stereo === 'unspecified') return true;
    if (!bond.stereoAtoms || !other.stereoAtoms) return bond.stereo === other.stereo;
    // cis/trans is relative to each bond's chosen substituents. Changing just
    // one end reverses it; changing both ends leaves it unchanged.
    const refs = map[bond.a] === other.a ? other.stereoAtoms : [...other.stereoAtoms].reverse();
    const flips = Number(map[bond.stereoAtoms[0]] !== refs[0]) + Number(map[bond.stereoAtoms[1]] !== refs[1]);
    return (bond.stereo === other.stereo) === (flips % 2 === 0);
  });
  const search = (depth, squared) => {
    if (++visits > nodeLimit) fail('DUPLICATE_WINDOW_MAPPING_LIMIT', 'Pose atom symmetry exceeded its safe comparison budget. Reduce the window or use one best placement per product.');
    if (depth === n) return stereoValid() ? [...map] : null;
    const i = order[depth];
    for (const j of candidates[i]) {
      if (used.has(j)) continue;
      let compatible = true;
      for (let k = 0; k < n; k++) if (map[k] >= 0) {
        const x = aa[i].get(k), y = bb[j].get(map[k]);
        if (Boolean(x) !== Boolean(y) || (x && x.order !== y.order)) { compatible = false; break; }
      }
      if (!compatible) continue;
      const cost = a.coords && b.coords ? a.coords[i].reduce((s, v, k) => s + (v - b.coords[j][k]) ** 2, 0) : 0;
      if (squared + cost > maxSquared + 1e-12) continue;
      map[i] = j; used.add(j);
      const result = search(depth + 1, squared + cost);
      if (result) return result;
      used.delete(j); map[i] = -1;
    }
    return null;
  };
  return search(0, 0);
}
export const samePose = (graph, a, b, window) => Boolean(atomMapping({ ...graph, coords: a }, { ...graph, coords: b }, { maxSquared: graph.atoms.length * window ** 2 }));

/** Disk-bounded complete candidate spool, discarded after terminal selection.
 * A top-K-only online RMSD cluster is unsafe: a later better representative can
 * suppress two previous hits and reopen a slot, resurrecting an evicted pose.
 * Thus all pair winners are scored/materialized, compactly spooled, then visited
 * once in deterministic scientific rank order. Never prune by a provisional K.
 */
export function createPoseSpool({ maxBytes = 512 * 1024 * 1024, directory = tmpdir() } = {}) {
  const folder = mkdtempSync(join(directory, 'pyxis-pose-window-'));
  chmodSync(folder, 0o700);
  const file = join(folder, 'candidates.sqlite'), db = new Database(file, { create: true });
  chmodSync(file, 0o600);
  db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE; CREATE TABLE graphs(id INTEGER PRIMARY KEY,smiles TEXT UNIQUE,graph TEXT); CREATE TABLE poses(id TEXT PRIMARY KEY,graph_id INTEGER,severe REAL,overlap REAL,clashes REAL,rmsd REAL,ratio REAL,conformer INTEGER,a INTEGER,b INTEGER,payload BLOB);');
  const getGraph = db.query('SELECT id,graph FROM graphs WHERE smiles=?');
  const putGraph = db.query('INSERT INTO graphs(smiles,graph) VALUES(?,?)');
  const put = db.query('INSERT OR IGNORE INTO poses VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  let bytes = 0, closed = false;
  const add = db.transaction(products => {
    for (const p of products) {
      const { graph, coords } = p.pose;
      let existing=getGraph.get(p.smiles);
      if (!existing) {
        const text = JSON.stringify({...graph,coords}); bytes += Buffer.byteLength(text)+Buffer.byteLength(p.smiles)+128; putGraph.run(p.smiles, text);
        existing=getGraph.get(p.smiles);
      }
      const baseline=JSON.parse(existing.graph).coords;
      // Identical uploaded atoms become zeros; graph/SMILES are interned once
      // per product, avoiding a large repeated scientific query payload on disk.
      const delta=coords.map((xyz,i)=>xyz.map((v,k)=>v-baseline[i][k]));
      const payload = deflateSync(Buffer.from(JSON.stringify({ ratio: p.ratio, receptor: p.receptor, linkerId: p.linkerId, delta })));
      bytes += payload.length + 128;
      if (bytes > maxBytes) fail('DUPLICATE_WINDOW_STORAGE_LIMIT', 'Distinct-placement search exceeded its private candidate storage budget; the scan is partial. Use one best placement per product or a narrower RMSD search.');
      const r = p.receptor;
      put.run(`${p.conformerId}-${p.pair[0]}-${p.pair[1]}`, existing.id, r?.severeClashes || 0, r?.overlapSquared || 0, r?.clashes || 0, p.rmsd, Number.isFinite(p.ratio) ? p.ratio : 1e99, p.conformerId, ...p.pair, payload);
    }
  });
  return {
    add(products) { if (closed) throw new Error('Pose spool closed.'); add(products); if (statSync(file).size > maxBytes) fail('DUPLICATE_WINDOW_STORAGE_LIMIT', 'Distinct-placement candidate storage exhausted; scan is partial.'); },
    select(limit, window) {
      const retained = [];
      for (const row of db.query('SELECT poses.*,graphs.smiles,graphs.graph FROM poses JOIN graphs ON graphs.id=poses.graph_id ORDER BY severe,overlap,clashes,rmsd,ratio DESC,conformer,a,b').iterate()) {
        const {delta,...metadata}=JSON.parse(inflateSync(row.payload).toString());
        const graph = JSON.parse(row.graph);
        const coords=delta.map((xyz,i)=>xyz.map((v,k)=>v+graph.coords[i][k]));
        const p={...metadata,smiles:row.smiles,rmsd:row.rmsd,conformerId:row.conformer,pair:[row.a,row.b],coords};
        if (retained.some(q => q.smiles === p.smiles && samePose(graph, p.coords, q.coords, window))) continue;
        retained.push(p);
        if (retained.length === limit) break;
      }
      return retained;
    },
    close() { if (closed) return; closed = true; db.close(); rmSync(folder, { recursive: true, force: true }); },
  };
}
