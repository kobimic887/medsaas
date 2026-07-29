from __future__ import annotations

from dataclasses import asdict, dataclass
from hashlib import sha256
import json
import os
from pathlib import Path


PREP_VERSION = "2026-07-29.chemistry-1"


@dataclass(frozen=True, slots=True)
class EngineConfig:
    # Five is an engine request target, never a success criterion.
    expected_pose_count: int = 5
    exhaustiveness: int = 8
    seed: int = 20_260_729
    energy_range: float = 1_000_000.0
    min_rmsd: float = 1.0
    max_evals: int = 0
    cpu: int = 1
    timeout_seconds: int = 540
    reproduce_torsdo_bug: bool = True
    default_torsdof: int = 0
    scoring_function: str = "vina"
    map_spacing: float = 0.375
    force_even_voxels: bool = True
    no_refine: bool = True


@dataclass(frozen=True, slots=True)
class ReceptorConfig:
    # The production grid dimensions were not measurable. These are deliberately centralized.
    holo_box_size: tuple[float, float, float] = (22.0, 22.0, 22.0)
    apo_padding: float = 8.0
    ph: float = 7.0
    pdbfixer_seed: int = 20_260_729
    rcsb_timeout_seconds: float = 30.0
    max_source_bytes: int = 25_000_000


@dataclass(frozen=True, slots=True)
class Settings:
    cache_dir: Path
    engine_name: str
    engine: EngineConfig
    receptor: ReceptorConfig = ReceptorConfig()

    @property
    def preparation_hash(self) -> str:
        payload = {
            "prep_version": PREP_VERSION,
            "receptor": asdict(self.receptor),
        }
        return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    @classmethod
    def from_environment(cls) -> "Settings":
        expected_pose_count = _positive_int("EXPECTED_POSE_COUNT", 5)
        engine_name = os.environ.get("DOCKING_ENGINE", "replay").lower()
        holo_box_size = tuple(
            _positive_float(name, value)
            for name, value in (
                ("VINA_BOX_X", 22.0),
                ("VINA_BOX_Y", 22.0),
                ("VINA_BOX_Z", 22.0),
            )
        )
        return cls(
            cache_dir=Path(os.environ.get("CACHE_DIR", "/srv/cache")),
            engine_name=engine_name,
            engine=EngineConfig(
                expected_pose_count=expected_pose_count,
                exhaustiveness=_positive_int("VINA_EXHAUSTIVENESS", 8),
                seed=int(os.environ.get("VINA_SEED", "20260729")),
                energy_range=_positive_float("VINA_ENERGY_RANGE", 1_000_000.0),
                min_rmsd=_positive_float("VINA_MIN_RMSD", 1.0),
                max_evals=_nonnegative_int("VINA_MAX_EVALS", 0),
                cpu=_positive_int("VINA_CPU", 1),
                timeout_seconds=_positive_int("VINA_TIMEOUT_SECONDS", 540),
                reproduce_torsdo_bug=_boolean("REPRODUCE_TORSDO_BUG", True),
                default_torsdof=_nonnegative_int("DEFAULT_TORSDOF", 0),
                scoring_function=_scoring_function(),
                map_spacing=_positive_float("VINA_MAP_SPACING", 0.375),
                force_even_voxels=_boolean("VINA_FORCE_EVEN_VOXELS", True),
                no_refine=_boolean("VINA_NO_REFINE", True),
            ),
            receptor=ReceptorConfig(
                holo_box_size=holo_box_size,  # type: ignore[arg-type]
                apo_padding=_positive_float("APO_BOX_PADDING", 8.0),
                ph=_positive_float("RECEPTOR_PH", 7.0),
                pdbfixer_seed=int(os.environ.get("PDBFIXER_SEED", "20260729")),
                rcsb_timeout_seconds=_positive_float("RCSB_TIMEOUT_SECONDS", 30.0),
                max_source_bytes=_positive_int("RCSB_MAX_SOURCE_BYTES", 25_000_000),
            ),
        )


def _positive_int(name: str, default: int) -> int:
    value = int(os.environ.get(name, str(default)))
    if value < 1:
        raise ValueError(f"{name} must be positive")
    return value


def _nonnegative_int(name: str, default: int) -> int:
    value = int(os.environ.get(name, str(default)))
    if value < 0:
        raise ValueError(f"{name} must be nonnegative")
    return value


def _positive_float(name: str, default: float) -> float:
    value = float(os.environ.get(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _boolean(name: str, default: bool) -> bool:
    value = os.environ.get(name, str(default)).strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean")


def _scoring_function() -> str:
    value = os.environ.get("VINA_SCORING_FUNCTION", "vina").strip().lower()
    if value not in {"vina", "vinardo"}:
        raise ValueError("VINA_SCORING_FUNCTION must be vina or vinardo")
    return value
