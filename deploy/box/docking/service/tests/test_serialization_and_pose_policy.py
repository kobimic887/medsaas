from __future__ import annotations

import json
import logging
from importlib.resources import files
from pathlib import Path

import pytest

from docking_service.cache import ReceptorCache
from docking_service.engines.replay import ReplayEngine
from docking_service.errors import DockingFailure
from docking_service.ligand import ReplayLigandPreparer
from docking_service.metrics import DockingMetrics
from docking_service.models import Box, NormalizedRequest, PreparedReceptor, Pose
from docking_service.serializer import serialize_sdf
from docking_service.service import DockingService
from docking_service.settings import EngineConfig, Settings


SMILES = "Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C"


class FixtureReceptorPreparer:
    def prepare(self, _request: NormalizedRequest, destination: Path) -> PreparedReceptor:
        (destination / "source.pdb").write_text("ATOM\nEND\n", encoding="ascii")
        (destination / "receptor.pdb").write_text("REMARK replay\nATOM\nTER\nEND\n", encoding="ascii")
        receptor_pdbqt = destination / "receptor.pdbqt"
        receptor_pdbqt.write_text("REMARK receptor\n", encoding="ascii")
        box = Box(center=(1.0, 2.0, 3.0), size=(22.0, 22.0, 22.0), ligand_resname="HED")
        (destination / "box.json").write_text(
            json.dumps({"center": box.center, "size": box.size, "ligand_resname": "HED"}),
            encoding="utf-8",
        )
        return PreparedReceptor(pdb=(destination / "receptor.pdb").read_text(), receptor_pdbqt=receptor_pdbqt, box=box)


class FixedPoseEngine:
    def __init__(self, count: int) -> None:
        source = ReplayEngine()
        self._poses = list(source._poses[:count])

    def dock(self, _receptor: Path, _ligand: Path, _box: Box, _cfg: EngineConfig) -> list[Pose]:
        return list(self._poses)


def _service(tmp_path: Path, count: int, metrics: DockingMetrics) -> DockingService:
    settings = Settings(cache_dir=tmp_path, engine_name="test", engine=EngineConfig())
    return DockingService(
        settings=settings,
        engine=FixedPoseEngine(count),
        metrics=metrics,
        cache=ReceptorCache(tmp_path, settings.preparation_hash),
        receptor_preparer=FixtureReceptorPreparer(),
        ligand_preparer=ReplayLigandPreparer(),
    )


def _request() -> NormalizedRequest:
    return NormalizedRequest(pdbid="1cx7", smiles=SMILES, smiles_sha256="test")


def test_serializer_reconstructs_committed_sdf_byte_for_byte() -> None:
    engine = ReplayEngine()
    expected = json.loads(files("docking_service").joinpath("assets/1cx7-asinex.json").read_text())["sdf"]
    actual = serialize_sdf(list(engine._poses), SMILES, EngineConfig())
    # This equality is the real assertion: byte-for-byte against the captured Asinex response.
    # It already fails if any of the below is wrong, but the explicit checks name what to look
    # at when it does.
    assert actual == expected
    for record_number in range(1, 6):
        assert actual.count(f">  <smiles>  ({record_number}) \n") == 1
    assert actual.count(">  <smiles>  (1) \n") == 1
    assert "> <smiles>" not in actual


def test_serializer_has_exact_tag_order_trailing_spaces_and_shared_decoded_smiles() -> None:
    engine = ReplayEngine()
    sdf = serialize_sdf(list(engine._poses), SMILES, EngineConfig())
    records = [record for record in sdf.split("$$$$\n") if record]
    assert len(records) == 5
    scores: list[float] = []
    # "(N)" is the 1-based record number, not a constant — the committed 1cx7 reference runs
    # (1)..(5). Asserting "(1)" on every record, as this used to, rejects the reference itself.
    for record_number, record in enumerate(records, start=1):
        tags = [line for line in record.splitlines() if line.startswith(">")]
        assert tags == [
            f">  <MODEL>  ({record_number}) ",
            f">  <TORSDO>  ({record_number}) ",
            f">  <SCORE>  ({record_number}) ",
            f">  <ligand_id>  ({record_number}) ",
            f">  <original_smiles>  ({record_number}) ",
            f">  <smiles>  ({record_number}) ",
        ]
        assert all(tag.endswith(" ") for tag in tags)
        assert record.count(f"\n{SMILES}\n\n") == 2
        # And the title is the 0-based pose ordinal for the same position.
        assert f"0:0:{record_number - 1}\n     RDKit          3D\n" in record
        score_line = record.split(f">  <SCORE>  ({record_number}) \n", 1)[1].split("\n", 1)[0]
        scores.append(float(score_line))
    assert scores == sorted(scores)


@pytest.mark.parametrize("count", [1, 3, 4, 5])
def test_every_positive_pose_count_is_usable_and_mismatches_are_observable(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, count: int
) -> None:
    metrics = DockingMetrics()
    with caplog.at_level(logging.WARNING):
        result = _service(tmp_path, count, metrics).dock(_request())
    assert result.sdf.count("$$$$") == count
    snapshot = metrics.snapshot()
    assert snapshot["successful_docks"] == 1
    assert snapshot[f"pose_count_{count}"] == 1
    if count == 5:
        assert "pose_count_mismatch" not in snapshot
        assert "differs from configured target" not in caplog.text
    else:
        assert snapshot["pose_count_mismatch"] == 1
        assert "differs from configured target" in caplog.text


def test_zero_poses_is_the_only_count_failure(tmp_path: Path) -> None:
    with pytest.raises(DockingFailure, match="zero poses"):
        _service(tmp_path, 0, DockingMetrics()).dock(_request())
