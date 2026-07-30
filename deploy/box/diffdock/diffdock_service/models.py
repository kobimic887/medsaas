from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import BaseModel, ConfigDict, Field


@dataclass(frozen=True, slots=True)
class Pose:
    sdf: str
    confidence: float
    trajectory: str = ""


@dataclass(frozen=True, slots=True)
class EngineRequest:
    """What an engine receives: decoded text, never the wire escaping."""

    protein_pdb: str
    ligand_sdf: str
    num_poses: int
    time_divisions: int
    steps: int
    save_trajectory: bool
    is_staged: bool = False
    labels: dict[str, str] = field(default_factory=dict)


class GenerateRequest(BaseModel):
    """The eight fields chem_beo sends. Six of them have never varied in production.

    Extra keys are accepted and ignored: the upstream NIM tolerates them, and rejecting an
    unknown field would turn a harmless caller change into an outage.
    """

    model_config = ConfigDict(extra="ignore")

    protein: str
    ligand: str
    ligand_file_type: str = "sdf"
    num_poses: int = Field(default=1, ge=1)
    time_divisions: int = Field(default=20, ge=1)
    steps: int = Field(default=18, ge=1)
    save_trajectory: bool = False
    is_staged: bool = False


class GenerateResponse(BaseModel):
    """Seven keys, in the captured order, on success AND on failure.

    `protein` and `ligand` are echoed back exactly as they arrived — including whatever
    escaping the caller applied. Verified against the captured failure payload, whose echoed
    ligand still carries the literal backslash-n form that caused the failure.
    """

    ligand_positions: list[str]
    trajectory: list[str]
    position_confidence: list[float | None]
    status: str
    details: str
    protein: str
    ligand: str
