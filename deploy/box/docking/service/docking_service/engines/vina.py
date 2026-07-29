from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
from tempfile import NamedTemporaryFile

from ..errors import DockingFailure, DockingTimeout
from ..models import Box, Pose
from ..settings import EngineConfig


class VinaEngine:
    """CPU Vina adapter; all native Vina/map work is isolated in vina_worker."""

    def dock(
        self,
        receptor_pdbqt: Path,
        ligand_pdbqt: Path,
        box: Box,
        cfg: EngineConfig,
    ) -> list[Pose]:
        if not receptor_pdbqt.is_file() or not ligand_pdbqt.is_file():
            raise DockingFailure("Vina did not receive complete receptor and ligand PDBQT artifacts")
        payload = {
            "receptor_pdbqt": str(receptor_pdbqt),
            "ligand_pdbqt": str(ligand_pdbqt),
            # The worker creates versioned map subcaches below this cache-entry maps directory.
            "maps_root": str(receptor_pdbqt.parent / "maps"),
            "box": {"center": box.center, "size": box.size},
            "config": {
                "expected_pose_count": cfg.expected_pose_count,
                "exhaustiveness": cfg.exhaustiveness,
                "seed": cfg.seed,
                "energy_range": cfg.energy_range,
                "min_rmsd": cfg.min_rmsd,
                "max_evals": cfg.max_evals,
                "cpu": cfg.cpu,
                "scoring_function": cfg.scoring_function,
                "map_spacing": cfg.map_spacing,
                "force_even_voxels": cfg.force_even_voxels,
                "no_refine": cfg.no_refine,
            },
        }
        with NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json", delete=False) as request_file:
            json.dump(payload, request_file, sort_keys=True, separators=(",", ":"))
            request_path = Path(request_file.name)
        try:
            completed = subprocess.run(
                [sys.executable, "-m", "docking_service.engines.vina_worker", str(request_path)],
                check=False,
                capture_output=True,
                text=True,
                timeout=cfg.timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            raise DockingTimeout("Vina worker exceeded its execution time limit") from exc
        finally:
            request_path.unlink(missing_ok=True)
        if completed.returncode != 0:
            # Native stderr can include paths/molecular data. Do not relay it to callers or logs.
            raise DockingFailure("Vina worker failed")
        try:
            values = json.loads(completed.stdout)["poses"]
            poses = [
                Pose(
                    mol_block=str(item["mol_block"]),
                    model=str(item["model"]),
                    torsdof=int(item["torsdof"]),
                    score=float(item["score"]),
                    score_text=str(item["score_text"]),
                    ligand_id=str(item["ligand_id"]),
                )
                for item in values
            ]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise DockingFailure("Vina worker returned an invalid result") from exc
        if not poses:
            raise DockingFailure("Vina produced zero poses")
        return poses
