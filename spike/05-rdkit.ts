import initRDKitModule from "../server/node_modules/@rdkit/rdkit/dist/RDKit_minimal.js";

const RDKit = await initRDKitModule();
const mol = RDKit.get_mol("c1ccccc1");

try {
  if (!mol || !mol.is_valid()) {
    console.error("RDKit returned an invalid molecule for benzene");
    process.exit(1);
  }

  console.log(`RDKit version: ${RDKit.version()}`);
  console.log(`benzene canonical SMILES: ${mol.get_smiles()}`);
} finally {
  if (mol) {
    mol.delete();
  }
}
