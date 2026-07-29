from __future__ import annotations

from pathlib import Path
from typing import Protocol

from ..models import Box, Pose
from ..settings import EngineConfig


class DockingEngine(Protocol):
    """Stable engine boundary; native Vina execution will run behind a subprocess boundary."""

    def dock(
        self,
        receptor_pdbqt: Path,
        ligand_pdbqt: Path,
        box: Box,
        cfg: EngineConfig,
    ) -> list[Pose]: ...
