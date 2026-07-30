from __future__ import annotations

import logging

import httpx

from .engines.base import DiffDockEngine
from .errors import ConversionFailure, DockFailure, InputError
from .models import EngineRequest, GenerateRequest, GenerateResponse, Pose
from .normalization import (
    decode_escaped,
    ensure_sdf_terminator,
    looks_like_sdf,
    require_protein,
)
from .settings import Settings

logger = logging.getLogger(__name__)

SUCCESS_DETAILS = "success without retry"


class DiffDockService:
    def __init__(self, settings: Settings, engine: DiffDockEngine) -> None:
        self._settings = settings
        self._engine = engine

    @property
    def engine(self) -> DiffDockEngine:
        return self._engine

    def generate(self, body: GenerateRequest) -> GenerateResponse:
        limits = self._settings.engine
        if len(body.protein) > limits.max_protein_bytes:
            raise InputError("protein exceeds the configured size limit")
        if len(body.ligand) > limits.max_ligand_bytes:
            raise InputError("ligand exceeds the configured size limit")

        num_poses = min(body.num_poses, limits.max_num_poses)

        try:
            request = self._build_engine_request(body, num_poses)
            poses = self._engine.dock(request)
        except DockFailure as failure:
            # HTTP 200 with status "failed" — this is the upstream contract, not an oversight.
            logger.info("dock failed: %s", failure)
            return self._envelope(body, num_poses, [], "failed", str(failure))

        return self._envelope(body, num_poses, poses, "success", SUCCESS_DETAILS)

    # ── internals ────────────────────────────────────────────────────────────

    def _build_engine_request(self, body: GenerateRequest, num_poses: int) -> EngineRequest:
        protein_text, protein_form = decode_escaped(body.protein)
        ligand_text, ligand_form = decode_escaped(body.ligand)

        # Logged so the caller's double escaping can eventually be cleaned up with evidence
        # rather than argument. Nothing here depends on the value.
        logger.info("wire forms: protein=%s ligand=%s", protein_form, ligand_form)

        protein_pdb = require_protein(protein_text)

        file_type = (body.ligand_file_type or "sdf").strip().lower()
        if file_type in {"smiles", "smi"} or not looks_like_sdf(ligand_text):
            ligand_text = self._smiles_to_sdf(ligand_text.strip())

        ligand_sdf = ensure_sdf_terminator(ligand_text)

        return EngineRequest(
            protein_pdb=protein_pdb,
            ligand_sdf=ligand_sdf,
            num_poses=num_poses,
            time_divisions=body.time_divisions,
            steps=body.steps,
            save_trajectory=body.save_trajectory,
            is_staged=body.is_staged,
            labels={"protein_form": protein_form, "ligand_form": ligand_form},
        )

    def _smiles_to_sdf(self, smiles: str) -> str:
        """Accept a SMILES as well as an SDF.

        The platform converts before calling, so this path is never taken in production today.
        It exists because compose already wires CONVERTSTR_URL into this container, and because
        a caller that skips the conversion should get a molecule rather than a confusing
        `Fail to read ligand molecule description`.
        """
        url = self._settings.convertstr_url
        if not url:
            # Deliberately the upstream string, not a new one. Without a converter this is
            # indistinguishable from the failure the platform already knows how to render,
            # and inventing a message here would make the caller's retry stop matching.
            raise DockFailure("Fail to read ligand molecule description")
        if not smiles:
            raise InputError("ligand is empty")
        try:
            response = httpx.post(url, json={"smiles": smiles}, timeout=60.0)
        except httpx.HTTPError as exc:
            raise ConversionFailure(f"convertSTR unreachable: {exc}") from exc
        if response.status_code >= 400:
            raise ConversionFailure(f"convertSTR returned {response.status_code}")
        try:
            sdf = response.json().get("sdf")
        except ValueError as exc:
            raise ConversionFailure("convertSTR returned a non-JSON body") from exc
        if not isinstance(sdf, str) or not sdf.strip():
            raise ConversionFailure("convertSTR returned no sdf")
        return sdf.replace("\r\n", "\n")

    @staticmethod
    def _envelope(
        body: GenerateRequest,
        num_poses: int,
        poses: list[Pose],
        status: str,
        details: str,
    ) -> GenerateResponse:
        """Build the seven-key body.

        Two properties the platform depends on, both learned from the captured traffic:

        1. every array is exactly `num_poses` long, padded with "" and null. A failed dock
           returns a hundred empty strings, not an empty array.
        2. `position_confidence[i]` belongs to `ligand_positions[i]`, ranked best-first.
           The dashboard used to pair pose 0 with confidence[-1] and show the best pose
           labelled with the worst score; preserving the order here keeps that fixed.
        """
        ranked = sorted(poses, key=lambda pose: pose.confidence, reverse=True)[:num_poses]

        positions: list[str] = [pose.sdf for pose in ranked]
        confidences: list[float | None] = [pose.confidence for pose in ranked]
        trajectories: list[str] = [pose.trajectory for pose in ranked]

        pad = num_poses - len(ranked)
        if pad > 0:
            positions.extend([""] * pad)
            confidences.extend([None] * pad)
            trajectories.extend([""] * pad)

        return GenerateResponse(
            ligand_positions=positions,
            trajectory=trajectories,
            position_confidence=confidences,
            status=status,
            details=details,
            protein=body.protein,
            ligand=body.ligand,
        )
