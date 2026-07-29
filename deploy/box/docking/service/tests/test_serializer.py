from __future__ import annotations

import pytest

from docking_service.errors import DockingFailure
from docking_service.models import Pose
from docking_service.serializer import serialize_sdf
from docking_service.settings import EngineConfig


MOL_BLOCK = """0:0:0
     RDKit          3D

  1  0  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
M  END
"""


def _pose(score: float, score_text: str, model: str, torsdof: int = 5) -> Pose:
    return Pose(
        mol_block=MOL_BLOCK,
        model=model,
        torsdof=torsdof,
        score=score,
        score_text=score_text,
        ligand_id="0",
    )


def test_serializer_sorts_numerically_and_reproduces_parser_sensitive_bytes() -> None:
    smiles = "C[N+](=O)[O-]"
    sdf = serialize_sdf(
        [_pose(-4.345, "-4.345", "2"), _pose(-4.547, "-4.547", "1")],
        smiles,
        EngineConfig(),
    )

    records = [record for record in sdf.split("$$$$") if record]
    assert len(records) == 2
    assert records[0].startswith("0:0:0\n     RDKit          3D\n")
    assert "\n-4.547\n\n" in records[0]
    assert "\n-4.345\n\n" in records[1]
    expected_tags = ["MODEL", "TORSDO", "SCORE", "ligand_id", "original_smiles", "smiles"]
    assert [
        line.removeprefix(">  <").removesuffix(">  (1) ")
        for line in records[0].splitlines()
        if line.startswith(">  <")
    ] == expected_tags
    assert ">  <TORSDO>  (1) \nF 5\n\n" in records[0]
    assert f">  <original_smiles>  (1) \n{smiles}\n\n" in records[0]
    assert f">  <smiles>  (1) \n{smiles}\n\n" in records[0]


def test_non_default_pose_count_remains_usable() -> None:
    sdf = serialize_sdf([_pose(-1.0, "-1.000", "1")], "CC", EngineConfig())
    assert sdf.count("$$$$") == 1


def test_clean_torsion_mode_uses_torsdof_tag_and_value() -> None:
    config = EngineConfig(reproduce_torsdo_bug=False)
    sdf = serialize_sdf([_pose(-1.0, "-1.000", "1", torsdof=3)], "CC", config)
    assert ">  <TORSDOF>  (1) \n3\n\n" in sdf
    assert ">  <TORSDO>" not in sdf


@pytest.mark.parametrize("poses", [[], [_pose(float("nan"), "nan", "1")]])
def test_unusable_pose_sets_fail_instead_of_returning_partial_success(poses: list[Pose]) -> None:
    with pytest.raises(DockingFailure):
        serialize_sdf(poses, "CC", EngineConfig())
