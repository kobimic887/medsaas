"""ADMET prediction, behind an interface.

Same rule as the docking and DiffDock services: the model is the only part that needs a GPU
and a multi-gigabyte download, so it sits behind a boundary and everything else is testable
without one. `ADMET_ENGINE=stub` is what the test suite runs on.
"""

from __future__ import annotations

import logging
from typing import Protocol

logger = logging.getLogger(__name__)


class Predictor(Protocol):
    name: str

    def predict(self, smiles: list[str]) -> dict: ...


def _to_plain(value):
    """Make a prediction JSON-serialisable without importing pandas at module scope."""
    if hasattr(value, "to_dict") and hasattr(value, "columns"):  # DataFrame
        records = value.to_dict(orient="records")
        return records
    if hasattr(value, "to_dict"):  # Series
        return value.to_dict()
    return value


class StubPredictor:
    """Deterministic fake. Never imports admet_ai, never touches a GPU."""

    name = "stub"

    def predict(self, smiles: list[str]) -> dict:
        return {
            "engine": self.name,
            "compounds": [
                {"smiles": entry, "molecular_weight": float(len(entry))} for entry in smiles
            ],
        }


class AdmetAiPredictor:
    """The real one. Loads the model ONCE, on first use.

    Loading is lazy rather than at construction so that a worker with a misconfigured Mongo
    fails on Mongo, not four minutes later on a model download.
    """

    name = "admet-ai"

    def __init__(self) -> None:
        self._model = None

    def _load(self):
        if self._model is None:
            from admet_ai import ADMETModel  # imported here on purpose — see class docstring

            logger.info("loading ADMET model")
            self._model = ADMETModel()
            logger.info("ADMET model ready")
        return self._model

    def predict(self, smiles: list[str]) -> dict:
        model = self._load()
        raw = _to_plain(model.predict(smiles))

        # The platform stores ONE admet object per simulation and the dashboard reads it as
        # a flat property bag. Multi-compound results keep every compound rather than
        # silently dropping all but the first, which is what the old sender did.
        if isinstance(raw, list):
            if len(raw) == 1:
                properties = raw[0]
            else:
                return {"engine": self.name, "compounds": raw}
        else:
            properties = raw

        if not isinstance(properties, dict):
            return {"engine": self.name, "value": properties}
        return {"engine": self.name, **properties}


def create_predictor(name: str) -> Predictor:
    engines = {"stub": StubPredictor, "admet-ai": AdmetAiPredictor}
    try:
        return engines[name]()
    except KeyError as exc:
        raise ValueError(f"ADMET_ENGINE must be one of {sorted(engines)}") from exc
