"""Deterministic, local SMILES-to-3D-SDF conversion service."""

from __future__ import annotations

from io import BytesIO
import logging
from math import isfinite

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from rdkit import Chem
from rdkit.Chem import AllChem

SEED = 20_260_729
logger = logging.getLogger("convertstr")

# Kept as module-level dependencies so the conversion path is easy to monkeypatch.
mol_from_smiles = Chem.MolFromSmiles
add_hs = Chem.AddHs
etkdg_v3 = AllChem.ETKDGv3
embed_molecule = AllChem.EmbedMolecule
mmff_has_all_molecule_params = AllChem.MMFFHasAllMoleculeParams
mmff_optimize_molecule = AllChem.MMFFOptimizeMolecule
mol_to_mol_block = Chem.MolToMolBlock
forward_sd_mol_supplier = Chem.ForwardSDMolSupplier

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class ConvertRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    smiles: str


class ConvertResponse(BaseModel):
    sdf: str


class ConversionError(ValueError):
    """An input or chemistry failure that callers can correct."""


def _is_real_3d(molecule: Chem.Mol) -> bool:
    """Require a finite, tagged-3D conformer with a non-flat Z axis."""
    try:
        if molecule.GetNumConformers() < 1:
            return False
        conformer = molecule.GetConformer()
        if not conformer.Is3D() or molecule.GetNumAtoms() == 0:
            return False
        has_nonzero_z = False
        for atom_index in range(molecule.GetNumAtoms()):
            position = conformer.GetAtomPosition(atom_index)
            if not all(isfinite(value) for value in (position.x, position.y, position.z)):
                return False
            has_nonzero_z |= abs(position.z) > 1e-6
        return has_nonzero_z
    except Exception:
        return False


def _parse_sdf(sdf: str) -> Chem.Mol | None:
    """Read the emitted SDF record rather than trusting its source molecule."""
    supplier = forward_sd_mol_supplier(
        BytesIO(sdf.encode("utf-8")), sanitize=True, removeHs=False
    )
    return next(supplier, None)


def convert_smiles(smiles: str) -> str:
    """Convert one SMILES string into a validated deterministic 3D SDF record."""
    if not smiles.strip():
        raise ConversionError("SMILES must not be empty")
    if ";" in smiles:
        raise ConversionError("SMILES containing ';' are not supported")

    try:
        molecule = mol_from_smiles(smiles)
    except Exception as error:
        raise ConversionError("SMILES could not be parsed") from error
    if molecule is None:
        raise ConversionError("SMILES could not be parsed")

    try:
        molecule = add_hs(molecule)
        parameters = etkdg_v3()
        parameters.randomSeed = SEED
        parameters.numThreads = 1
        if embed_molecule(molecule, parameters) != 0:
            raise ConversionError("Could not generate a 3D conformer")
        if not mmff_has_all_molecule_params(molecule):
            raise ConversionError("Molecule is not supported by the MMFF force field")
        if (
            mmff_optimize_molecule(
                molecule,
                mmffVariant="MMFF94",
                maxIters=1_000,
            )
            != 0
        ):
            raise ConversionError("MMFF optimization did not converge")
    except ConversionError:
        raise
    except Exception as error:
        raise ConversionError("Could not generate and optimize a 3D conformer") from error

    if not _is_real_3d(molecule):
        raise ConversionError("Generated conformer is not valid 3D geometry")

    try:
        mol_block = mol_to_mol_block(molecule)
        if not mol_block.strip():
            raise ConversionError("Generated SDF is empty")
        normalized_block = mol_block.replace("\r\n", "\n").replace("\r", "\n")
        sdf = f"{normalized_block.rstrip(chr(10))}\n$$$$\n"
        reparsed = _parse_sdf(sdf)
    except ConversionError:
        raise
    except Exception as error:
        raise ConversionError("Could not serialize the generated SDF") from error

    if reparsed is None or not _is_real_3d(reparsed):
        raise ConversionError("Generated SDF failed 3D validation")
    if reparsed.GetNumAtoms() != molecule.GetNumAtoms():
        raise ConversionError("Generated SDF did not preserve every atom")

    expected_hydrogens = sum(
        atom.GetAtomicNum() == 1 for atom in molecule.GetAtoms()
    )
    actual_hydrogens = sum(
        atom.GetAtomicNum() == 1 for atom in reparsed.GetAtoms()
    )
    if actual_hydrogens != expected_hydrogens:
        raise ConversionError("Generated SDF did not preserve explicit hydrogens")
    return sdf


@app.exception_handler(ConversionError)
async def handle_conversion_error(_: Request, error: ConversionError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": str(error)})


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"error": "Request body must contain a string 'smiles' field"},
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(_: Request, error: Exception) -> JSONResponse:
    logger.error(
        "Unhandled conversion error",
        exc_info=(type(error), error, error.__traceback__),
    )
    return JSONResponse(status_code=500, content={"error": "Internal conversion error"})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/convertSTR", response_model=ConvertResponse)
def convert_str(payload: ConvertRequest) -> ConvertResponse:
    return ConvertResponse(sdf=convert_smiles(payload.smiles))
