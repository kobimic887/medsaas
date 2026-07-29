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

    # `.strip()`, not truthiness: the file ends "$$$$\n", so splitting on the bare delimiter
    # always leaves a trailing "\n" element. Filtering on `if record` kept it and made this
    # assert 3 == 2 — it just had never been run. validate_serialized_sdf splits the same way
    # and has always used .strip().
    records = [record for record in sdf.split("$$$$") if record.strip()]
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


def test_titles_are_renumbered_to_score_order_not_engine_order() -> None:
    """A pose title is its position in the emitted file, not the engine's conformer index.

    Vina happens to return poses in ascending energy today, so the two agree — but "happens
    to" is not a contract, and the serializer validates that the title matches the record
    position. Without renumbering, an engine that returned poses in any other order would make
    a dock that genuinely succeeded fail serialization, which the platform surfaces as a 502
    and a refunded credit for work that was done.
    """
    out_of_order = [
        Pose(mol_block=MOL_BLOCK.replace("0:0:0", "0:0:7", 1), model="8", torsdof=5,
             score=-4.345, score_text="-4.345", ligand_id="0"),
        Pose(mol_block=MOL_BLOCK.replace("0:0:0", "0:0:3", 1), model="4", torsdof=5,
             score=-6.120, score_text="-6.120", ligand_id="0"),
    ]
    sdf = serialize_sdf(out_of_order, "CC", EngineConfig())

    records = [record for record in sdf.split("$$$$") if record.strip()]
    assert len(records) == 2
    # Best score first, titled 0:0:0, whatever the engine called it.
    assert records[0].lstrip("\n").startswith("0:0:0\n     RDKit          3D\n")
    assert "\n-6.120\n\n" in records[0]
    assert records[1].lstrip("\n").startswith("0:0:1\n     RDKit          3D\n")
    assert "\n-4.345\n\n" in records[1]
    # MODEL is the engine's own label and is deliberately NOT renumbered — it is what the
    # platform shows, and rewriting it would lose the link back to the engine's output.
    assert ">  <MODEL>  (1) \n4\n\n" in records[0]
    assert ">  <MODEL>  (2) \n8\n\n" in records[1]


def test_a_title_that_is_not_a_pose_title_is_left_alone_and_rejected() -> None:
    """Renumbering must not paper over a mol block from somewhere unexpected."""
    foreign = Pose(mol_block=MOL_BLOCK.replace("0:0:0", "some other title", 1), model="1",
                   torsdof=5, score=-1.0, score_text="-1.000", ligand_id="0")
    with pytest.raises(DockingFailure):
        serialize_sdf([foreign], "CC", EngineConfig())


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
