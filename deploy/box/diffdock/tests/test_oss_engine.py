"""Everything about the OSS engine that does not need a GPU.

Inference itself cannot be tested until the box exists. The argv it builds and the output
directory it reads can be, and those are where the mistakes that survive to arrival day live.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from diffdock_service.engines.oss import OssDiffDockEngine
from diffdock_service.errors import EngineUnavailable
from diffdock_service.models import EngineRequest
from diffdock_service.settings import Settings


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        engine_name="oss",
        repo_dir=tmp_path / "repo",
        model_dir=tmp_path / "models",
        work_dir=tmp_path / "work",
        convertstr_url="",
        python_executable="python",
    )


def _request(**overrides) -> EngineRequest:
    base = dict(
        protein_pdb="ATOM      1  N   MET A   1\n",
        ligand_sdf="\n     RDKit          3D\n\nM  END\n$$$$\n",
        num_poses=100,
        time_divisions=20,
        steps=18,
        save_trajectory=False,
    )
    base.update(overrides)
    return EngineRequest(**base)


def test_preflight_fails_loudly_without_a_checkout(tmp_path: Path) -> None:
    engine = OssDiffDockEngine(_settings(tmp_path))
    with pytest.raises(EngineUnavailable, match="inference.py"):
        engine.preflight()


def test_preflight_fails_on_empty_weights_directory(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    settings.repo_dir.mkdir(parents=True)
    (settings.repo_dir / "inference.py").write_text("")
    settings.model_dir.mkdir(parents=True)
    engine = OssDiffDockEngine(settings)
    with pytest.raises(EngineUnavailable, match="empty"):
        engine.preflight()


def test_nim_parameters_map_onto_upstream_flags(tmp_path: Path) -> None:
    """time_divisions -> --inference_steps, steps -> --actual_steps, num_poses -> samples."""
    engine = OssDiffDockEngine(_settings(tmp_path))
    argv = engine.build_argv(
        _request(num_poses=100, time_divisions=20, steps=18),
        tmp_path / "p.pdb",
        tmp_path / "l.sdf",
        tmp_path / "out",
    )
    pairs = dict(zip(argv, argv[1:]))
    assert pairs["--inference_steps"] == "20"
    assert pairs["--actual_steps"] == "18"
    assert pairs["--samples_per_complex"] == "100"
    assert "--save_visualisation" not in argv


def test_complex_name_is_empty_so_poses_are_titled_rank_n(tmp_path: Path) -> None:
    """The captured Asinex poses begin `_rank1`, i.e. `{complex_name}_rank1` with no name."""
    engine = OssDiffDockEngine(_settings(tmp_path))
    argv = engine.build_argv(_request(), tmp_path / "p.pdb", tmp_path / "l.sdf", tmp_path / "o")
    assert argv[argv.index("--complex_name") + 1] == ""


def test_save_trajectory_requests_the_visualisation(tmp_path: Path) -> None:
    engine = OssDiffDockEngine(_settings(tmp_path))
    argv = engine.build_argv(
        _request(save_trajectory=True), tmp_path / "p.pdb", tmp_path / "l.sdf", tmp_path / "o"
    )
    assert "--save_visualisation" in argv


def test_poses_are_collected_in_rank_order_and_rank1_is_not_double_counted(tmp_path: Path) -> None:
    out = tmp_path / "out" / "complex"
    out.mkdir(parents=True)
    # This is DiffDock's real layout: rank1 is written TWICE, once without a confidence.
    (out / "rank1.sdf").write_text("duplicate of the top pose")
    (out / "rank1_confidence-0.36.sdf").write_text("pose one")
    (out / "rank2_confidence-1.04.sdf").write_text("pose two")
    (out / "rank10_confidence-4.20.sdf").write_text("pose ten")

    poses = OssDiffDockEngine.collect_poses(tmp_path / "out", save_trajectory=False)

    assert [p.sdf for p in poses] == ["pose one", "pose two", "pose ten"]
    assert [p.confidence for p in poses] == [-0.36, -1.04, -4.20]


def test_trajectory_is_read_only_when_asked_for(tmp_path: Path) -> None:
    out = tmp_path / "out" / "complex"
    out.mkdir(parents=True)
    (out / "rank1_confidence-0.36.sdf").write_text("pose one")
    (out / "rank1_reverseprocess.pdb").write_text("MODEL 1")

    without = OssDiffDockEngine.collect_poses(tmp_path / "out", save_trajectory=False)
    with_traj = OssDiffDockEngine.collect_poses(tmp_path / "out", save_trajectory=True)

    assert without[0].trajectory == ""
    assert with_traj[0].trajectory == "MODEL 1"


def test_missing_output_directory_is_not_a_crash(tmp_path: Path) -> None:
    assert OssDiffDockEngine.collect_poses(tmp_path / "nope", save_trajectory=False) == []
