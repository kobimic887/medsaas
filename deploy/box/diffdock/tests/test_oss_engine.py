"""Everything about the OSS engine that does not need a GPU.

Inference itself cannot be tested until the box exists. The argv it builds and the output
directory it reads can be, and those are where the mistakes that survive to arrival day live.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from diffdock_service.engines.oss import OssDiffDockEngine
from diffdock_service.errors import EngineUnavailable
from diffdock_service.models import EngineRequest
from diffdock_service.settings import Settings


def _settings(tmp_path: Path) -> Settings:
    (tmp_path / "repo").mkdir(parents=True, exist_ok=True)
    (tmp_path / "repo" / "default_inference_args.yaml").write_text(
        "samples_per_complex: 10\nactual_steps: 19\nmodel_dir: ./workdir/score_model\n"
        "confidence_ckpt: best_model_epoch75.pt\ntemp_sampling_tr: 1.170050527854316\n"
    )
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
    settings.repo_dir.mkdir(parents=True, exist_ok=True)
    (settings.repo_dir / "inference.py").write_text("")
    settings.model_dir.mkdir(parents=True)
    engine = OssDiffDockEngine(settings)
    with pytest.raises(EngineUnavailable, match="missing or empty"):
        engine.preflight()


def test_effective_yaml_overrides_upstream_defaults_and_retains_model_settings(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    engine = OssDiffDockEngine(settings)
    argv = engine.build_argv(
        _request(num_poses=3, time_divisions=24, steps=18, save_trajectory=True),
        tmp_path / "p.pdb", tmp_path / "l.sdf", tmp_path / "out",
    )
    assert argv[:4] == ["python", "-m", "inference", "--config"]
    config = yaml.safe_load(Path(argv[4]).read_text())
    # Upstream loads these AFTER parsing argv: CLI flags alone cannot override them.
    assert config["samples_per_complex"] == 3
    assert config["inference_steps"] == 24
    assert config["actual_steps"] == 18
    assert config["model_dir"] == str(settings.model_dir / "score_model")
    assert config["confidence_model_dir"] == str(settings.model_dir / "confidence_model")
    assert config["confidence_ckpt"] == "best_model_epoch75.pt"
    assert config["temp_sampling_tr"] == 1.170050527854316
    assert config["save_visualisation"] is True
    assert config["protein_path"] == str(tmp_path / "p.pdb")


def test_preflight_rejects_partial_weights(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    (settings.repo_dir / "inference.py").write_text("")
    model = settings.model_dir / "score_model"
    model.mkdir(parents=True)
    (model / "model_parameters.yml").write_text("test")
    with pytest.raises(EngineUnavailable, match="best_ema"):
        OssDiffDockEngine(settings).preflight()


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


def test_subprocess_receives_effective_request_config(tmp_path: Path) -> None:
    from dataclasses import replace
    import sys

    settings = replace(_settings(tmp_path), python_executable=sys.executable)
    (settings.repo_dir / "inference.py").write_text("""
import argparse
from pathlib import Path
import yaml
parser = argparse.ArgumentParser()
parser.add_argument('--config')
args = parser.parse_args()
cfg = yaml.safe_load(Path(args.config).read_text())
assert cfg['actual_steps'] == 18
assert cfg['confidence_ckpt'] == 'best_model_epoch75.pt'
assert '/models/score_model' in cfg['model_dir']
assert Path(cfg['protein_path']).read_text().startswith('ATOM')
out = Path(cfg['out_dir']) / cfg['complex_name']
out.mkdir(parents=True)
for rank in range(1, cfg['samples_per_complex'] + 1):
    (out / f'rank{rank}_confidence-{rank}.00.sdf').write_text('pose')
""")
    # Fake weights isolate subprocess wiring; they do not qualify inference.
    for relative in (
        "score_model/model_parameters.yml", "score_model/best_ema_inference_epoch_model.pt",
        "confidence_model/model_parameters.yml", "confidence_model/best_model_epoch75.pt",
        "torch/hub/checkpoints/esm2_t33_650M_UR50D.pt",
        "torch/hub/checkpoints/esm2_t33_650M_UR50D-contact-regression.pt",
    ):
        artifact = settings.model_dir / relative
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_text("fixture")
    poses = OssDiffDockEngine(settings).dock(_request(num_poses=3))
    assert len(poses) == 3
    assert [pose.confidence for pose in poses] == [-1, -2, -3]
    assert not list(settings.work_dir.iterdir())
