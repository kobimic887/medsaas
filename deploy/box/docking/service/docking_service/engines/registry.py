from __future__ import annotations

from .autodock_gpu import AutoDockGpuEngine
from .base import DockingEngine
from .replay import ReplayEngine
from .vina import VinaEngine
from ..errors import InputError


def create_engine(name: str) -> DockingEngine:
    engines: dict[str, DockingEngine] = {
        "replay": ReplayEngine(),
        "vina": VinaEngine(),
        "autodock-gpu": AutoDockGpuEngine(),
    }
    try:
        return engines[name]
    except KeyError as exc:
        raise InputError("DOCKING_ENGINE must be replay, vina, or autodock-gpu") from exc
