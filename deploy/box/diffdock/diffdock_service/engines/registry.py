from __future__ import annotations

from .base import DiffDockEngine
from .oss import OssDiffDockEngine
from .replay import ReplayEngine
from ..errors import InputError
from ..settings import Settings


def create_engine(settings: Settings) -> DiffDockEngine:
    name = settings.engine_name
    if name == "replay":
        return ReplayEngine()
    if name == "oss":
        return OssDiffDockEngine(settings)
    raise InputError("DIFFDOCK_ENGINE must be replay or oss")
