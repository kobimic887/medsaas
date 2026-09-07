// Demo-mode OpenFold3 fixture generator (staging only).
//
// This module deliberately produces PLACEHOLDER coordinates so the staging UI
// and Molstar viewer can be exercised end to end without any real (paid)
// NVIDIA prediction. It never fabricates confidence metrics, and callers label
// the output as a demo/sample — not as a real prediction.
//
// The response envelope mirrors the documented NVIDIA OpenFold3 shape that
// client/src/utils/openfold.js already extracts:
//   outputs[].structures_with_scores[].structure
// so the same client code path is used for the fixture and for a real run.

const AMINO_1TO3 = {
  A: "ALA", R: "ARG", N: "ASN", D: "ASP", C: "CYS",
  E: "GLU", Q: "GLN", G: "GLY", H: "HIS", I: "ILE",
  L: "LEU", K: "LYS", M: "MET", F: "PHE", P: "PRO",
  S: "SER", T: "THR", W: "TRP", Y: "TYR", V: "VAL",
};

const HELIX_DEG = 2.399; // ~137.5° per residue → turn of 3.6 residues
const HELIX_RADIUS = 2.3;
const HELIX_RISE = 1.5;

function pad(str, width) {
  return String(str).padStart(width, " ");
}

/** PDB atom line (columns 1-6 record, 7-11 serial, 13-16 name, 17 altLoc,
 *  18-20 resName, 22 chain, 23-26 resSeq, 31-38/39-46/47-54 xyz,
 *  55-60 occ, 61-66 b, 77-78 element). */
function pdbAtomLine({ record, serial, name, resName, chain, resSeq, x, y, z, element }) {
  const fields =
    record.padEnd(6) +
    pad(serial, 5) +
    " " +
    name.padEnd(4) +
    " " +
    resName.padStart(3) +
    " " +
    chain +
    pad(resSeq, 4) +
    "    " +
    x.toFixed(3).padStart(8) +
    y.toFixed(3).padStart(8) +
    z.toFixed(3).padStart(8) +
    "  1.00 20.00".padEnd(14) +
    "          " +
    element.padStart(2);
  return fields.slice(0, 80);
}

function seqResidues(type, sequence) {
  const letters = String(sequence || "").replace(/\s/g, "").toUpperCase();
  if (type === "protein") return letters.split("").filter((c) => AMINO_1TO3[c] || c === "X");
  if (type === "dna") return letters.split("").filter((c) => "ACGT".includes(c));
  if (type === "rna") return letters.split("").filter((c) => "ACGU".includes(c));
  return [];
}

/**
 * Idealized placeholder coordinates for one polymer chain. Backbone atoms
 * (N/CA/C/O for protein, P for nucleic acids) follow an alpha-helix trace so
 * Molstar can render a readable chain; geometry is demonstrative only.
 */
function chainCoordinateText({ type, id, residues }, outFormat) {
  const atomRows = [];
  let serial = 1;
  const points = [];
  residues.forEach((_r, i) => {
    const a = i * HELIX_DEG;
    points.push({
      x: HELIX_RADIUS * Math.cos(a),
      y: HELIX_RADIUS * Math.sin(a),
      z: i * HELIX_RISE,
    });
  });

  const tangent = (i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / len, y: dy / len, z: dz / len };
  };

  residues.forEach((letter, i) => {
    const p = points[i];
    const t = tangent(i);
    const seqNum = i + 1;
    if (type === "protein") {
      const resName = AMINO_1TO3[letter] || "GLY";
      // Crude but valid-looking backbone offsets around the trace.
      const n = { x: p.x - 0.35 * t.x, y: p.y - 0.35 * t.y, z: p.z + 0.55 - 0.35 * t.z };
      const c = { x: p.x + 0.6 * t.x, y: p.y + 0.6 * t.y, z: p.z - 0.4 + 0.6 * t.z };
      const o = { x: c.x + 0.5 * t.x, y: c.y + 0.5 * t.y, z: c.z + 0.4 };
      [
        { name: "N  ", el: "N", ...n },
        { name: "CA ", el: "C", ...p },
        { name: "C  ", el: "C", ...c },
        { name: "O  ", el: "O", ...o },
      ].forEach((atom) => {
        atomRows.push({ name: atom.name, resName, chain: id, resSeq: seqNum, element: atom.el, x: atom.x, y: atom.y, z: atom.z });
      });
    } else {
      // Nucleic acids: one phosphate-trace atom per residue.
      const resName = type === "dna" ? `D${letter}` : letter;
      atomRows.push({ name: "P  ", resName, chain: id, resSeq: seqNum, element: "P", x: p.x, y: p.y, z: p.z });
    }
  });

  if (outFormat === "mmcif") {
    const lines = [
      "data_pyxis_demo_placeholder",
      "#",
      "_entry.id pyxis_demo_placeholder",
      "#",
      "_pdbx_audit_conform.dict_name       mmcif_pdbx.dic",
      "_pdbx_audit_conform.dict_version     0.4.4",
      "#",
      "_atom_site.group_PDB",
      "_atom_site.id",
      "_atom_site.type_symbol",
      "_atom_site.label_atom_id",
      "_atom_site.label_alt_id",
      "_atom_site.label_comp_id",
      "_atom_site.label_asym_id",
      "_atom_site.label_entity_id",
      "_atom_site.label_seq_id",
      "_atom_site.pdbx_PDB_ins_code",
      "_atom_site.Cartn_x",
      "_atom_site.Cartn_y",
      "_atom_site.Cartn_z",
      "_atom_site.occupancy",
      "_atom_site.B_iso_or_equiv",
      "_atom_site.auth_seq_id",
      "_atom_site.auth_comp_id",
      "_atom_site.auth_asym_id",
      "_atom_site.auth_atom_id",
      "_atom_site.pdbx_PDB_model_num",
      "loop_",
    ];
    atomRows.forEach((a, idx) => {
      const atomName = a.name.trim();
      const comp = a.resName.trim();
      lines.push(
        `ATOM  ${idx + 1} ${a.element.padEnd(2)} ${atomName.padEnd(4)} . ${comp.padEnd(3)} ${id} 1 ${a.resSeq} ? ${a.x.toFixed(3)} ${a.y.toFixed(3)} ${a.z.toFixed(3)} 1.00 20.00 ${a.resSeq} ${comp} ${id} ${atomName} 1`
      );
    });
    lines.push("#");
    return lines.join("\n");
  }

  const lines = [];
  atomRows.forEach((a) => {
    serial += 1;
    lines.push(
      pdbAtomLine({
        record: "ATOM",
        serial,
        name: a.name,
        resName: a.resName,
        chain: id,
        resSeq: a.resSeq,
        x: a.x,
        y: a.y,
        z: a.z,
        element: a.element,
      })
    );
  });
  lines.push("END");
  return lines.join("\n");
}

/** Very small ligand placeholder (single pseudo-atom). */
function ligandCoordinateText({ id, ccdOrSmiles }, outFormat) {
  const label = (String(ccdOrSmiles || "UNL").match(/[A-Za-z0-9]{1,3}/) || ["UNL"])[0].toUpperCase();
  if (outFormat === "mmcif") {
    return [
      "data_pyxis_demo_placeholder",
      "#",
      "_entry.id pyxis_demo_placeholder",
      "#",
      "_atom_site.group_PDB",
      "_atom_site.id",
      "_atom_site.type_symbol",
      "_atom_site.label_atom_id",
      "_atom_site.label_alt_id",
      "_atom_site.label_comp_id",
      "_atom_site.label_asym_id",
      "_atom_site.label_entity_id",
      "_atom_site.label_seq_id",
      "_atom_site.pdbx_PDB_ins_code",
      "_atom_site.Cartn_x",
      "_atom_site.Cartn_y",
      "_atom_site.Cartn_z",
      "_atom_site.occupancy",
      "_atom_site.B_iso_or_equiv",
      "_atom_site.auth_seq_id",
      "_atom_site.auth_comp_id",
      "_atom_site.auth_asym_id",
      "_atom_site.auth_atom_id",
      "_atom_site.pdbx_PDB_model_num",
      "loop_",
      `HETATM 1 C   UNL . ${label.padEnd(3)} ${id} 1 1 ? 0.000 0.000 0.000 1.00 20.00 1 ${label} ${id} UNL 1`,
      "#",
    ].join("\n");
  }
  const line = pdbAtomLine({
    record: "HETATM",
    serial: 1,
    name: "UNL",
    resName: label.slice(0, 3),
    chain: id,
    resSeq: 1,
    x: 0,
    y: 0,
    z: 0,
    element: "C",
  });
  return `${line}\nEND`;
}

/** Deterministic placeholder structure text from one molecule entry. */
export function fixtureStructureText(molecule, outputFormat) {
  const type = String(molecule?.type || "").toLowerCase();
  const chainId = String(molecule?.id || "A").toUpperCase().slice(0, 1) || "A";
  if (type === "ligand") {
    return ligandCoordinateText({ id: chainId, ccdOrSmiles: molecule.smiles || molecule.ccd_codes }, outputFormat);
  }
  const residues = seqResidues(type, molecule.sequence);
  if (!residues.length) {
    throw Object.assign(new Error(`Cannot build a demo structure for an empty ${type || "unknown"} chain (${chainId}).`), {
      status: 400,
    });
  }
  return chainCoordinateText({ type, id: chainId, residues }, outputFormat);
}

/**
 * Build a fixture response in the documented NVIDIA envelope. Throws on
 * malformed payloads (validation is still the client's job; this is a second
 * net). Returns { response, entitySummary } — entitySummary records chain
 * lengths/types for run metadata without trusting client text.
 */
export function buildFixtureFoldResponse(body, outputFormat) {
  const input = Array.isArray(body?.inputs) ? body.inputs[0] : null;
  const molecules = Array.isArray(input?.molecules) ? input.molecules : [];
  if (!molecules.length) {
    throw Object.assign(new Error("The request contains no molecules."), { status: 400 });
  }
  const output = outputFormat === "mmcif" ? "mmcif" : "pdb";
  const structures = [];
  const entitySummary = [];
  for (const molecule of molecules) {
    const type = String(molecule?.type || "").toLowerCase();
    if (!["protein", "dna", "rna", "ligand"].includes(type)) {
      throw Object.assign(new Error(`Unsupported molecule type: ${molecule?.type}`), { status: 400 });
    }
    if (!molecule?.id || typeof molecule.id !== "string") {
      throw Object.assign(new Error("Every molecule needs a chain ID."), { status: 400 });
    }
    const text = fixtureStructureText(molecule, output);
    structures.push({ structure: text });
    const seq = String(molecule.sequence || "").replace(/\s/g, "");
    const length =
      type === "ligand"
        ? String(molecule.smiles || molecule.ccd_codes || "").length
        : seq.length;
    entitySummary.push({ id: String(molecule.id).toUpperCase().slice(0, 1), type, length });
  }
  const requestId = typeof body.request_id === "string" ? body.request_id : "demo";
  return {
    response: {
      request_id: requestId,
      outputs: [{ input_id: requestId, structures_with_scores: structures }],
      // Staging-only marker the UI reads to label the result as a demo output.
      // Not part of the NVIDIA contract; clients must not treat it as one.
      _pyxisDemo: true,
      _pyxisProvider: "pyxis-staging-demo-fixture",
    },
    entitySummary,
  };
}
