from __future__ import annotations

import json
from importlib.resources import files
from pathlib import Path
import re

from ..errors import UnsupportedFixtureError
from ..models import Box, NormalizedRequest, Pose
from ..settings import EngineConfig

_TAG_RE = re.compile(r"^>  <(?P<name>[^>]+)>  \(1\) $", re.MULTILINE)


class ReplayEngine:
    """Replays parsed, committed Asinex reference poses through the normal pipeline."""

    fixture_pdbid = "1cx7"
    fixture_smiles = "Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C"

    def __init__(self) -> None:
        fixture_path = files("docking_service").joinpath("assets/1cx7-asinex.json")
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        self._pdb = self._require_text(payload, "pdb")
        self._poses = self._parse_sdf(self._require_text(payload, "sdf"))

    @property
    def reference_pdb(self) -> str:
        return self._pdb

    def assert_supported(self, request: NormalizedRequest) -> None:
        if request.pdbid != self.fixture_pdbid or request.smiles != self.fixture_smiles:
            raise UnsupportedFixtureError()

    def dock(
        self,
        receptor_pdbqt: Path,
        ligand_pdbqt: Path,
        box: Box,
        cfg: EngineConfig,
    ) -> list[Pose]:
        del box, cfg
        if not receptor_pdbqt.is_file() or not ligand_pdbqt.is_file():
            raise RuntimeError("replay pipeline did not provide prepared artifacts")
        return list(self._poses)

    @staticmethod
    def _require_text(payload: object, key: str) -> str:
        if not isinstance(payload, dict) or not isinstance(payload.get(key), str) or not payload[key]:
            raise RuntimeError(f"invalid committed replay fixture: missing {key}")
        return payload[key]

    @classmethod
    def _parse_sdf(cls, sdf: str) -> tuple[Pose, ...]:
        poses: list[Pose] = []
        for record in sdf.split("$$$$"):
            if not record.strip():
                continue
            if not record.endswith("\n"):
                raise RuntimeError("invalid committed replay fixture: SDF record is not newline-terminated")
            marker = "M  END\n"
            marker_index = record.find(marker)
            if marker_index < 0:
                raise RuntimeError("invalid committed replay fixture: molecule block lacks M  END")
            mol_block = record[: marker_index + len(marker)]
            tags = cls._parse_tags(record[marker_index + len(marker) :])
            try:
                torsdo_match = re.fullmatch(r"F\s+(\d+)", tags["TORSDO"])
                torsdof = int(torsdo_match.group(1)) if torsdo_match else None
                pose = Pose(
                    mol_block=mol_block,
                    model=tags["MODEL"],
                    torsdof=torsdof,
                    score=float(tags["SCORE"]),
                    score_text=tags["SCORE"],
                    ligand_id=tags["ligand_id"],
                )
            except (KeyError, ValueError) as exc:
                raise RuntimeError("invalid committed replay fixture: required pose field is invalid") from exc
            poses.append(pose)
        if not poses:
            raise RuntimeError("invalid committed replay fixture: no poses")
        return tuple(poses)

    @staticmethod
    def _parse_tags(properties: str) -> dict[str, str]:
        lines = properties.splitlines()
        tags: dict[str, str] = {}
        index = 0
        while index < len(lines):
            match = _TAG_RE.fullmatch(lines[index])
            if match is None:
                if lines[index]:
                    raise RuntimeError("invalid committed replay fixture: malformed property tag")
                index += 1
                continue
            if index + 2 >= len(lines) or lines[index + 2] != "":
                raise RuntimeError("invalid committed replay fixture: malformed property value")
            tags[match.group("name")] = lines[index + 1]
            index += 3
        return tags
