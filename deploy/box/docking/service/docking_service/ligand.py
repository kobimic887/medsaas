from __future__ import annotations

from pathlib import Path
from typing import Protocol

from .errors import InputError
from .models import NormalizedRequest, PreparedLigand


class LigandPreparer(Protocol):
    def prepare(self, request: NormalizedRequest, destination: Path) -> PreparedLigand: ...


class ReplayLigandPreparer(LigandPreparer):
    """Replay still creates a normal per-request artifact, but never fabricates poses."""

    def prepare(self, request: NormalizedRequest, destination: Path) -> PreparedLigand:
        ligand = destination / "ligand.pdbqt"
        ligand.write_text(
            "REMARK replay ligand generated from the supported committed fixture\n",
            encoding="utf-8",
        )
        return PreparedLigand(ligand_pdbqt=ligand, torsdof=0)


_MAX_LIGAND_ATOMS = 512


def validate_decoded_smiles(smiles: str) -> None:
    """Reject non-chemistry before a receptor download/cache mutation or native Vina work."""
    from rdkit import Chem

    molecule = Chem.MolFromSmiles(smiles, sanitize=True)
    if molecule is None:
        raise InputError("smiles is not valid, sanitizable chemistry")
    if molecule.GetNumAtoms() > _MAX_LIGAND_ATOMS:
        raise InputError("smiles exceeds the supported atom limit")


class MeekoLigandPreparer(LigandPreparer):
    """Strict decoded-SMILES to deterministic Meeko PDBQT conversion."""

    def prepare(self, request: NormalizedRequest, destination: Path) -> PreparedLigand:
        # Imports remain here so the HTTP process can provide a readable controlled failure when
        # the scientific image was assembled incorrectly rather than fail at module import time.
        from rdkit import Chem
        from rdkit.Chem import AllChem
        from meeko import MoleculePreparation, PDBQTWriterLegacy

        molecule = Chem.MolFromSmiles(request.smiles, sanitize=True)
        if molecule is None:
            raise InputError("smiles is not valid, sanitizable chemistry")
        if molecule.GetNumAtoms() > _MAX_LIGAND_ATOMS:
            raise InputError("smiles exceeds the supported atom limit")

        molecule = Chem.AddHs(molecule)
        embed = AllChem.ETKDGv3()
        embed.randomSeed = 0xF00D
        embed.enforceChirality = True
        conformer_id = AllChem.EmbedMolecule(molecule, embed)
        if conformer_id < 0:
            raise InputError("deterministic ETKDGv3 ligand embedding failed")

        try:
            setups = MoleculePreparation().prepare(molecule, conformer_id=conformer_id)
        except Exception as exc:  # Meeko has several validation exception types.
            raise InputError("Meeko could not prepare the ligand") from exc
        if len(setups) != 1:
            raise InputError("Meeko produced an unsupported number of ligand preparations")
        pdbqt, success, error = PDBQTWriterLegacy.write_string(setups[0])
        if not success or not pdbqt:
            raise InputError(f"Meeko could not write ligand PDBQT: {error or 'unknown error'}")

        torsdof = _torsdof_from_pdbqt(pdbqt)
        ligand = destination / "ligand.pdbqt"
        ligand.write_text(pdbqt, encoding="utf-8")
        return PreparedLigand(ligand_pdbqt=ligand, torsdof=torsdof)


def _torsdof_from_pdbqt(pdbqt: str) -> int:
    for line in pdbqt.splitlines():
        if line.startswith("TORSDOF "):
            try:
                value = int(line.split()[1])
            except (IndexError, ValueError) as exc:
                raise InputError("Meeko emitted an invalid TORSDOF record") from exc
            if value < 0:
                raise InputError("Meeko emitted a negative TORSDOF value")
            return value
    raise InputError("Meeko did not emit a final TORSDOF record")
