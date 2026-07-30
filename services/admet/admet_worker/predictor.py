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
    """Deterministic fake. Never imports admet_ai, never touches a GPU.

    Emits the SAME shape as the real predictor — flat first compound, `compounds` only when
    there is more than one — so the tests exercise the contract the dashboard actually
    reads rather than a convenient stand-in for it.
    """

    name = "stub"

    def predict(self, smiles: list[str]) -> dict:
        records = [{"smiles": entry, "molecular_weight": float(len(entry))} for entry in smiles]
        if not records:
            return {"engine": self.name}
        payload = {"engine": self.name, **records[0]}
        if len(records) > 1:
            payload["compounds"] = records
        return payload


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

        # ⚠ The shape here is a CONTRACT with the dashboard, not a free choice.
        # client/src/pages/dashboard/controlpanel.jsx reads simulation.admet as a FLAT
        # property bag — admet.molecular_weight, admet.logP, admet.AMES and ~40 more. An
        # earlier version of this method returned {"compounds": [...]} whenever more than
        # one molecule was predicted, which rendered the success layout with every single
        # field showing "N/A" and no error anywhere.
        #
        # So the first compound is always flattened to the top level, which is what the
        # dashboard renders and what the old sender did (`predictions.iloc[0]`). The
        # difference is that the remaining compounds are no longer discarded: they are kept
        # under `compounds`, each labelled with its SMILES so the rows can be told apart.
        records = raw if isinstance(raw, list) else [raw]
        records = [record for record in records if isinstance(record, dict)]

        if not records:
            return {"engine": self.name, "value": raw}

        labelled = [
            {"smiles": smiles[index] if index < len(smiles) else None, **record}
            for index, record in enumerate(records)
        ]

        payload = {"engine": self.name, **records[0]}
        if len(labelled) > 1:
            payload["compounds"] = labelled
        return payload


def create_predictor(name: str) -> Predictor:
    engines = {"stub": StubPredictor, "admet-ai": AdmetAiPredictor}
    try:
        return engines[name]()
    except KeyError as exc:
        raise ValueError(f"ADMET_ENGINE must be one of {sorted(engines)}") from exc
