from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _path(name: str, default: str) -> Path:
    return Path(os.environ.get(name) or default)


@dataclass(frozen=True, slots=True)
class EngineConfig:
    # NVIDIA's DiffDock NIM exposes `time_divisions` and `steps`; upstream DiffDock calls the
    # same two knobs `inference_steps` and `actual_steps`. The mapping below is what makes a
    # request written for Asinex mean the same thing here:
    #
    #   time_divisions -> --inference_steps   (upstream default 20; production always sends 20)
    #   steps          -> --actual_steps      (upstream default 19; production always sends 18)
    #   num_poses      -> --samples_per_complex
    #
    # Both production values sit on top of upstream's own defaults, which is the strongest
    # available evidence that the mapping is right.
    batch_size: int = 10
    inference_timeout_seconds: int = 540
    # chem_beo aborts the whole call at 600 s (EXTERNAL_HTTP_TIMEOUT_LONG_MS). Finishing
    # *inside* that leaves room to serialize ~100 poses and still answer.
    max_num_poses: int = 100
    max_protein_bytes: int = 25_000_000
    max_ligand_bytes: int = 5_000_000


@dataclass(frozen=True, slots=True)
class Settings:
    engine_name: str
    repo_dir: Path
    model_dir: Path
    work_dir: Path
    convertstr_url: str
    python_executable: str
    engine: EngineConfig = EngineConfig()

    @classmethod
    def from_environment(cls) -> Settings:
        return cls(
            engine_name=(os.environ.get("DIFFDOCK_ENGINE") or "replay").strip().lower(),
            repo_dir=_path("DIFFDOCK_REPO_DIR", "/opt/diffdock"),
            model_dir=_path("DIFFDOCK_MODEL_DIR", "/models"),
            work_dir=_path("DIFFDOCK_WORK_DIR", "/tmp/diffdock"),
            convertstr_url=(os.environ.get("CONVERTSTR_URL") or "").strip(),
            python_executable=os.environ.get("DIFFDOCK_PYTHON") or "python",
            engine=EngineConfig(
                batch_size=_int("DIFFDOCK_BATCH_SIZE", 10),
                inference_timeout_seconds=_int("DIFFDOCK_TIMEOUT_SECONDS", 540),
                max_num_poses=_int("DIFFDOCK_MAX_POSES", 100),
            ),
        )
