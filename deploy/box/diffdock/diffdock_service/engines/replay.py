from __future__ import annotations

import json
from importlib.resources import files

from ..errors import DockFailure
from ..models import EngineRequest, Pose
from ..normalization import looks_like_sdf


class ReplayEngine:
    """Serves real Asinex poses from the captured reference. No GPU, no network, no weights.

    It is the default so that every other stage — decoding, padding, ranking, the envelope —
    is exercised by the test suite on a laptop. It holds four poses; asking for a hundred is
    the padding path, which is exactly the behaviour that used to make a failed dock look
    like a hundred successful ones.
    """

    name = "replay"

    def __init__(self) -> None:
        asset = files("diffdock_service").joinpath("assets/replay-poses.json")
        payload = json.loads(asset.read_text(encoding="utf-8"))
        self._poses = [
            Pose(sdf=entry["sdf"], confidence=float(entry["confidence"]))
            for entry in payload["poses"]
        ]
        if not self._poses:
            raise RuntimeError("replay asset holds no poses")

    def preflight(self) -> None:
        return None

    def dock(self, request: EngineRequest) -> list[Pose]:
        # Reproduce the one failure the platform actually hits, so the failed envelope is
        # reachable from a test without a GPU.
        if not looks_like_sdf(request.ligand_sdf):
            raise DockFailure("Fail to read ligand molecule description")

        poses = self._poses[: request.num_poses]
        if not request.save_trajectory:
            return poses
        return [Pose(sdf=p.sdf, confidence=p.confidence, trajectory="") for p in poses]
