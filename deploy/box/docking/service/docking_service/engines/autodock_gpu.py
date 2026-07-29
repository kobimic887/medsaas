from __future__ import annotations

from pathlib import Path

from ..errors import DockingUnavailable
from ..models import Box, Pose
from ..settings import EngineConfig


class AutoDockGpuEngine:
    """Deliberately unavailable until native RTX 5090 hardware qualification completes."""

    @staticmethod
    def require_qualified() -> None:
        raise DockingUnavailable(
            "AutoDock-GPU is unavailable until hardware qualification is complete"
        )

    def dock(
        self,
        receptor_pdbqt: Path,
        ligand_pdbqt: Path,
        box: Box,
        cfg: EngineConfig,
    ) -> list[Pose]:
        del receptor_pdbqt, ligand_pdbqt, box, cfg
        self.require_qualified()
