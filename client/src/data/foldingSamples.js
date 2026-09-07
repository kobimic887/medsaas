// Curated, benign sample library for the Protein Folding experience.
//
// Two distinct kinds, deliberately kept apart:
//
// 1. INPUT presets — they only pre-fill the guided form. Running "Predict"
//    afterwards issues a real request (on the live product) or the labelled
//    demo fixture (on staging); the sample is the *input*, never a result.
// 2. SAMPLE STRUCTURES — pre-existing coordinate files for viewer testing
//    (PDB and mmCIF). These are example structures with recorded provenance,
//    NOT newly generated NVIDIA predictions, and carry no confidence scores.
//
// Nothing here invents confidence scores or binding affinities.

export const FOLDING_INPUT_SAMPLES = [
  {
    id: "1crn-single",
    title: "Crambin, single protein",
    mode: "single",
    summary: "46-residue plant protein. Public sequence from RCSB PDB entry 1CRN.",
    provenance: {
      kind: "public-sequence",
      source: "RCSB PDB entry 1CRN (crambin)",
      url: "https://www.rcsb.org/structure/1CRN",
    },
    name: "Crambin 1CRN single chain",
    requestId: "crambin-1crn",
    outputFormat: "pdb",
    entities: [
      { type: "protein", id: "A", sequence: "TTCCPSIVARSNFNVCRLPGTPEAICATYTGCIIIPGATCPGDYAN" },
    ],
  },
  {
    id: "1crn-complex",
    title: "Crambin dimer (complex)",
    mode: "complex",
    summary: "Two identical protein chains (A + B) as a homodimer complex. Public sequences from 1CRN.",
    provenance: {
      kind: "public-sequence",
      source: "RCSB PDB entry 1CRN (chains A and B)",
      url: "https://www.rcsb.org/structure/1CRN",
    },
    name: "Crambin 1CRN dimer",
    requestId: "crambin-dimer",
    outputFormat: "pdb",
    entities: [
      { type: "protein", id: "A", sequence: "TTCCPSIVARSNFNVCRLPGTPEAICATYTGCIIIPGATCPGDYAN" },
      { type: "protein", id: "B", sequence: "TTCCPSIVARSNFNVCRLPGTPEAICATYTGCIIIPGATCPGDYAN" },
    ],
  },
  {
    id: "synthetic-dna-rna",
    title: "DNA + RNA duplex (synthetic demo)",
    mode: "complex",
    summary: "Short synthetic DNA and RNA strands to exercise a nucleic-acid complex request.",
    provenance: { kind: "synthetic", source: "Synthetic demo sequences for interface testing" },
    name: "Synthetic DNA/RNA duplex",
    requestId: "na-duplex-demo",
    outputFormat: "pdb",
    entities: [
      { type: "dna", id: "D", sequence: "AGGAACACGTGACCC" },
      { type: "rna", id: "R", sequence: "AGUUCGCAUGGCUAA" },
    ],
  },
  {
    id: "synthetic-protein-ligand",
    title: "Protein + ATP ligand (synthetic demo)",
    mode: "complex",
    summary: "A tiny synthetic protein with the ATP ligand by CCD code, to exercise mixed entity input.",
    provenance: { kind: "synthetic", source: "Synthetic demo input for interface testing" },
    name: "Synthetic protein + ATP",
    requestId: "protein-atp-demo",
    outputFormat: "pdb",
    entities: [
      { type: "protein", id: "P", sequence: "MGRTWKLVFDY" },
      { type: "ligand", id: "L", ligandMode: "ccd", ccdCode: "ATP", smiles: "" },
    ],
  },
];

// Sample STRUCTURES for viewer testing (real coordinates, recorded provenance).
// The coordinate files ship in client/public/folding-samples/ and load as text.
export const FOLDING_STRUCTURE_SAMPLES = [
  {
    id: "1crn-pdb",
    title: "1CRN crambin — PDB",
    summary: "Public crambin coordinates (chain A) in PDB format, for PDB viewer testing.",
    format: "pdb",
    fileName: "1crn.pdb",
    provenance: {
      kind: "public-structure",
      source: "RCSB PDB entry 1CRN (crambin), chain A",
      url: "https://www.rcsb.org/structure/1CRN",
      note: "Example structure for viewer testing — not a newly generated prediction.",
    },
    name: "1CRN-crambin",
  },
  {
    id: "1crn-cif",
    title: "1CRN crambin — mmCIF",
    summary: "The same public crambin entry in mmCIF format, for mmCIF viewer testing.",
    format: "mmcif",
    fileName: "1crn.cif",
    provenance: {
      kind: "public-structure",
      source: "RCSB PDB entry 1CRN (crambin)",
      url: "https://www.rcsb.org/structure/1CRN",
      note: "Example structure for viewer testing — not a newly generated prediction.",
    },
    name: "1CRN-crambin",
  },
];
