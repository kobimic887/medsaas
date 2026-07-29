from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


class DockingRequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_by_alias=True, validate_by_name=False)

    pdbid: str = Field(validation_alias=AliasChoices("pdbID", "pdbid"))
    smiles: str

    @model_validator(mode="before")
    @classmethod
    def reject_conflicting_pdb_aliases(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        upper = value.get("pdbID")
        lower = value.get("pdbid")
        if upper is not None and lower is not None and upper != lower:
            raise ValueError("pdbID and pdbid must agree when both are supplied")
        return value


class DockingResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pdb: str
    sdf: str


@dataclass(frozen=True, slots=True)
class NormalizedRequest:
    pdbid: str
    smiles: str
    smiles_sha256: str


@dataclass(frozen=True, slots=True)
class Box:
    center: tuple[float, float, float]
    size: tuple[float, float, float]
    ligand_resname: str | None = None
    fallback_reason: str | None = None


REPLAY_BOX: Final = Box(center=(0.0, 0.0, 0.0), size=(1.0, 1.0, 1.0))


@dataclass(frozen=True, slots=True)
class Pose:
    mol_block: str
    model: str
    torsdof: int | None
    score: float
    score_text: str
    ligand_id: str


@dataclass(frozen=True, slots=True)
class PreparedReceptor:
    pdb: str
    receptor_pdbqt: Path
    box: Box
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PreparedLigand:
    ligand_pdbqt: Path
    torsdof: int = 0


@dataclass(frozen=True, slots=True)
class DockingResult:
    pdb: str
    sdf: str
