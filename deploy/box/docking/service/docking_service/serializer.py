from __future__ import annotations

import math
import re

from .errors import DockingFailure
from .models import Pose
from .settings import EngineConfig

_BUG_TAG_ORDER = ("MODEL", "TORSDO", "SCORE", "ligand_id", "original_smiles", "smiles")
_CLEAN_TAG_ORDER = ("MODEL", "TORSDOF", "SCORE", "ligand_id", "original_smiles", "smiles")
# The leading newlines are record-separator bytes; see validate_serialized_sdf.
_TITLE_RE = re.compile(r"\n*0:0:(?P<ordinal>\d+)\n     RDKit          3D\n")
_POSE_TITLE_RE = re.compile(r"^\s*0:0:\d+\s*$")


def serialize_sdf(poses: list[Pose], smiles: str, config: EngineConfig) -> str:
    """Write the parser-sensitive SDF property tags exactly as the platform expects."""
    if not poses:
        raise DockingFailure("docking produced zero poses")

    sorted_poses = sorted(poses, key=lambda pose: pose.score)
    rendered: list[str] = []
    for record_number, pose in enumerate(sorted_poses, start=1):
        if not math.isfinite(pose.score) or not pose.mol_block.rstrip().endswith("M  END"):
            raise DockingFailure("docking produced an unusable pose")
        # Renumber the title to the pose's position in *this* file, rather than trusting the
        # engine to have already ordered by score. The reference runs 0:0:0 .. 0:0:4 in score
        # order, and today Vina happens to return poses in ascending energy so the two agree —
        # but "happens to" is not a contract. Rewriting here means an engine that returns poses
        # in any other order still produces a correct file, instead of failing validation below
        # and turning a dock that genuinely succeeded into a 502 and a refunded credit.
        mol_block = _retitle(pose.mol_block, record_number - 1)
        torsdof = pose.torsdof if pose.torsdof is not None else config.default_torsdof
        torsion_tag = "TORSDO" if config.reproduce_torsdo_bug else "TORSDOF"
        tag_order = _BUG_TAG_ORDER if config.reproduce_torsdo_bug else _CLEAN_TAG_ORDER
        values = {
            "MODEL": pose.model,
            torsion_tag: f"F {torsdof}" if config.reproduce_torsdo_bug else str(torsdof),
            "SCORE": pose.score_text,
            "ligand_id": pose.ligand_id,
            "original_smiles": smiles,
            "smiles": smiles,
        }
        # The "(N)" is the 1-based record number within the file, not a constant. RDKit's
        # SDWriter emits it that way and so does Asinex: the committed 1cx7 reference runs
        # (1)..(5) across its five poses. Writing (1) everywhere diverges from the reference
        # at every pose after the first.
        properties = "".join(
            f">  <{tag}>  ({record_number}) \n{values[tag]}\n\n" for tag in tag_order
        )
        rendered.append(f"{mol_block}{properties}$$$$\n")

    sdf = "".join(rendered)
    validate_serialized_sdf(sdf, smiles, config)
    return sdf


def _retitle(mol_block: str, ordinal: int) -> str:
    """Set the mol block's title line to this pose's 0-based position in the file.

    The title is line 1 of a V2000 block. It is only rewritten when it already looks like a
    pose title (`0:0:<n>`) — a block carrying some other title is left alone and left to fail
    validation, because silently overwriting an unrecognised title would hide a real problem
    with whatever produced it.
    """
    head, separator, tail = mol_block.partition("\n")
    if not separator or not _POSE_TITLE_RE.match(head):
        return mol_block
    return f"0:0:{ordinal}\n{tail}"


def validate_serialized_sdf(sdf: str, smiles: str, config: EngineConfig) -> None:
    records = [record for record in sdf.split("$$$$") if record.strip()]
    if not records:
        raise DockingFailure("docking serializer produced no SDF records")

    scores: list[float] = []
    for record_number, record in enumerate(records, start=1):
        # Two things this used to get wrong, both confirmed against the committed 1cx7
        # reference and an independent capture taken 2026-07-29:
        #
        #   * the title's third field is the 0-based pose ordinal, so the five reference
        #     poses are titled 0:0:0 .. 0:0:4, not 0:0:0 five times;
        #   * splitting on "$$$$" leaves every record after the first with a leading
        #     newline, because the delimiter line is followed by a blank one.
        #
        # Pinning this to a bare "0:0:0" prefix rejected the reference itself.
        title = _TITLE_RE.match(record)
        if title is None or "M  END\n" not in record:
            raise DockingFailure("docking serializer produced an invalid V2000 record")
        if int(title.group("ordinal")) != record_number - 1:
            raise DockingFailure("docking serializer wrote a pose title out of order")
        torsion_tag = "TORSDO" if config.reproduce_torsdo_bug else "TORSDOF"
        expected = [
            ("MODEL", None),
            (torsion_tag, None),
            ("SCORE", None),
            ("ligand_id", None),
            ("original_smiles", smiles),
            ("smiles", smiles),
        ]
        cursor = record.index("M  END\n") + len("M  END\n")
        for tag, expected_value in expected:
            prefix = f">  <{tag}>  ({record_number}) \n"
            if not record.startswith(prefix, cursor):
                raise DockingFailure(f"docking serializer wrote malformed {tag} tag")
            cursor += len(prefix)
            value_end = record.find("\n\n", cursor)
            if value_end < 0:
                raise DockingFailure(f"docking serializer wrote malformed {tag} value")
            value = record[cursor:value_end]
            if expected_value is not None and value != expected_value:
                raise DockingFailure(f"docking serializer changed decoded {tag}")
            if tag == "SCORE":
                try:
                    score = float(value)
                except ValueError as exc:
                    raise DockingFailure("docking serializer wrote a non-numeric score") from exc
                if not math.isfinite(score):
                    raise DockingFailure("docking serializer wrote a non-finite score")
                scores.append(score)
            cursor = value_end + 2
        if cursor != len(record):
            raise DockingFailure("docking serializer wrote unexpected SDF data")

    if scores != sorted(scores):
        raise DockingFailure("docking serializer did not sort scores ascending")
