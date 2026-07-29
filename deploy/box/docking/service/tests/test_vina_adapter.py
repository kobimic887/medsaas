from __future__ import annotations

import json
from pathlib import Path
import subprocess

import pytest

from docking_service.engines.vina import VinaEngine
from docking_service.engines.vina_worker import _ensure_maps, _sha256, _valid_maps
from docking_service.errors import DockingFailure, DockingTimeout
from docking_service.metrics import DockingMetrics
from docking_service.models import Box
from docking_service.normalization import normalize_request
from docking_service.service import DockingService
from docking_service.settings import EngineConfig, Settings


def _artifacts(tmp_path: Path) -> tuple[Path, Path, Box]:
    receptor = tmp_path / "receptor.pdbqt"
    ligand = tmp_path / "ligand.pdbqt"
    receptor.write_text("REMARK receptor\n", encoding="ascii")
    ligand.write_text("TORSDOF 2\n", encoding="ascii")
    return receptor, ligand, Box(center=(1.0, 2.0, 3.0), size=(22.0, 22.0, 22.0))


def test_vina_adapter_serializes_worker_request_and_parses_worker_response(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    receptor, ligand, box = _artifacts(tmp_path)
    observed: dict[str, object] = {}

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        observed["command"] = command
        observed["request"] = json.loads(Path(command[-1]).read_text(encoding="utf-8"))
        assert kwargs["timeout"] == 540
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps(
                {
                    "poses": [
                        {
                            "mol_block": "0:0:0\n     RDKit          3D\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n",
                            "model": "1",
                            "torsdof": 2,
                            "score": -4.5,
                            "score_text": "-4.500",
                            "ligand_id": "0",
                        }
                    ]
                }
            ),
        )

    monkeypatch.setattr("docking_service.engines.vina.subprocess.run", fake_run)
    poses = VinaEngine().dock(receptor, ligand, box, EngineConfig())
    assert len(poses) == 1
    assert poses[0].score_text == "-4.500"
    assert observed["command"][:3] == [__import__("sys").executable, "-m", "docking_service.engines.vina_worker"]
    request = observed["request"]
    assert isinstance(request, dict)
    assert request["maps_root"] == str(tmp_path / "maps")
    assert request["box"] == {"center": [1.0, 2.0, 3.0], "size": [22.0, 22.0, 22.0]}


def test_vina_adapter_maps_timeout_and_invalid_worker_output_to_controlled_errors(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    receptor, ligand, box = _artifacts(tmp_path)

    def timeout(*_args: object, **_kwargs: object) -> None:
        raise subprocess.TimeoutExpired("vina", 1)

    monkeypatch.setattr("docking_service.engines.vina.subprocess.run", timeout)
    with pytest.raises(DockingTimeout):
        VinaEngine().dock(receptor, ligand, box, EngineConfig(timeout_seconds=1))

    monkeypatch.setattr(
        "docking_service.engines.vina.subprocess.run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess([], 0, stdout="not json"),
    )
    with pytest.raises(DockingFailure, match="invalid result"):
        VinaEngine().dock(receptor, ligand, box, EngineConfig())


def test_vina_worker_creates_and_reuses_atomic_map_subcache(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    receptor, _ligand, box = _artifacts(tmp_path)
    # Mirror production cache layout: CACHE_DIR/receptors/<pdbid>/maps
    # so lock-root resolution (maps_root.parent.parent.parent / "locks")
    # lands inside tmp_path instead of at the filesystem root.
    receptor_dir = tmp_path / "receptors" / "1cx7"
    receptor_dir.mkdir(parents=True)
    maps_root = receptor_dir / "maps"
    maps_root.mkdir()
    (receptor_dir / "META.json").write_text("{}", encoding="utf-8")
    calls: list[str] = []

    class FakeVina:
        def __init__(self, **_kwargs: object) -> None:
            return None

        def set_receptor(self, **kwargs: object) -> None:
            calls.append(str(kwargs["rigid_pdbqt_filename"]))

        def compute_vina_maps(self, **_kwargs: object) -> None:
            calls.append("compute")

        def write_maps(self, prefix: str, overwrite: bool) -> None:
            assert overwrite is True
            Path(f"{prefix}.C.map").write_text("map", encoding="ascii")

    monkeypatch.setattr("docking_service.engines.vina_worker._vina_version", lambda: "mock-vina")
    cfg = {
        "scoring_function": "vina", "cpu": 1, "seed": 7, "no_refine": True,
        "map_spacing": 0.375, "force_even_voxels": True,
    }
    box_data = {"center": box.center, "size": box.size}
    first = _ensure_maps(FakeVina, receptor, maps_root, box_data, cfg)
    second = _ensure_maps(FakeVina, receptor, maps_root, box_data, cfg)
    assert first == second
    assert first.name == "vina"
    assert calls.count("compute") == 1
    assert not list(maps_root.glob(".*.retired.*"))
    metadata = json.loads((receptor_dir / "META.json").read_text(encoding="utf-8"))
    assert metadata["maps"]["state"] == "complete"
    assert metadata["measured_bytes"] > 0


@pytest.mark.vina
def test_vina_cpu_reference_integration_against_rcsb(tmp_path: Path) -> None:
    """Remote-only integration: fetches RCSB and runs the real CPU Vina adapter."""
    settings = Settings(
        cache_dir=tmp_path,
        engine_name="vina",
        engine=EngineConfig(expected_pose_count=1, exhaustiveness=1, cpu=1, timeout_seconds=540),
    )
    service = DockingService.for_engine(settings, VinaEngine(), DockingMetrics())
    request = normalize_request(
        pdbid="1cx7",
        smiles="Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C",
        metrics=DockingMetrics(),
    )
    result = service.dock(request)
    assert result.pdb.startswith("REMARK   1 CREATED WITH OPENMM 8.2")
    assert result.sdf.count("$$$$") >= 1


# --- Malformed map metadata tests (P0) ---


def _valid_maps_dir(tmp_path: Path, provenance: dict[str, object]) -> Path:
    """Create a structurally valid map subcache directory for _valid_maps testing."""
    target = tmp_path / "valid_maps"
    target.mkdir()
    map_file = target / "vina.C.map"
    map_file.write_text("map-data", encoding="ascii")
    meta = {
        **provenance,
        "files": {
            "vina.C.map": {
                "sha256": _sha256(map_file),
                "bytes": map_file.stat().st_size,
            }
        },
    }
    (target / "META.json").write_text(json.dumps(meta), encoding="utf-8")
    return target


def _base_provenance() -> dict[str, object]:
    return {"receptor_pdbqt_sha256": "abc", "scoring_function": "vina"}


def test_valid_maps_accepts_a_correct_map_directory(tmp_path: Path) -> None:
    provenance = _base_provenance()
    target = _valid_maps_dir(tmp_path, provenance)
    assert _valid_maps(target, provenance) is True


def test_valid_maps_rejects_scalar_files_field(tmp_path: Path) -> None:
    provenance = _base_provenance()
    target = _valid_maps_dir(tmp_path, provenance)
    meta = json.loads((target / "META.json").read_text())
    meta["files"] = "not-a-dict"
    (target / "META.json").write_text(json.dumps(meta))
    assert _valid_maps(target, provenance) is False


def test_valid_maps_rejects_empty_files_dict(tmp_path: Path) -> None:
    provenance = _base_provenance()
    target = _valid_maps_dir(tmp_path, provenance)
    meta = json.loads((target / "META.json").read_text())
    meta["files"] = {}
    (target / "META.json").write_text(json.dumps(meta))
    assert _valid_maps(target, provenance) is False


def test_valid_maps_rejects_traversal_filename(tmp_path: Path) -> None:
    provenance = _base_provenance()
    target = _valid_maps_dir(tmp_path, provenance)
    meta = json.loads((target / "META.json").read_text())
    meta["files"]["../escape.map"] = {"sha256": "x", "bytes": 1}
    (target / "META.json").write_text(json.dumps(meta))
    assert _valid_maps(target, provenance) is False


def test_valid_maps_rejects_symlink_file(tmp_path: Path) -> None:
    provenance = _base_provenance()
    target = _valid_maps_dir(tmp_path, provenance)
    real = tmp_path / "real_file"
    real.write_text("data", encoding="ascii")
    link = target / "symlinked.map"
    link.symlink_to(real)

    meta = json.loads((target / "META.json").read_text())
    meta["files"]["symlinked.map"] = {"sha256": _sha256(link), "bytes": link.stat().st_size}
    (target / "META.json").write_text(json.dumps(meta))
    assert _valid_maps(target, provenance) is False


def test_valid_maps_rejects_wrong_hash(tmp_path: Path) -> None:
    provenance = _base_provenance()
    target = _valid_maps_dir(tmp_path, provenance)
    meta = json.loads((target / "META.json").read_text())
    meta["files"]["vina.C.map"]["sha256"] = "deadbeef"
    (target / "META.json").write_text(json.dumps(meta))
    assert _valid_maps(target, provenance) is False


def test_valid_maps_rejects_wrong_size(tmp_path: Path) -> None:
    provenance = _base_provenance()
    target = _valid_maps_dir(tmp_path, provenance)
    meta = json.loads((target / "META.json").read_text())
    meta["files"]["vina.C.map"]["bytes"] = 99999
    (target / "META.json").write_text(json.dumps(meta))
    assert _valid_maps(target, provenance) is False


def test_valid_maps_rejects_provenance_mismatch(tmp_path: Path) -> None:
    provenance = _base_provenance()
    target = _valid_maps_dir(tmp_path, provenance)
    assert _valid_maps(target, {**provenance, "scoring_function": "vinardo"}) is False


def test_valid_maps_rejects_missing_meta(tmp_path: Path) -> None:
    target = tmp_path / "no_meta"
    target.mkdir()
    assert _valid_maps(target, _base_provenance()) is False


def test_valid_maps_rejects_nonexistent_directory(tmp_path: Path) -> None:
    assert _valid_maps(tmp_path / "nonexistent", _base_provenance()) is False
