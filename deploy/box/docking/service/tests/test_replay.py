from pathlib import Path

import pytest

from docking_service.engines.replay import ReplayEngine
from docking_service.errors import UnsupportedFixtureError
from docking_service.metrics import DockingMetrics
from docking_service.normalization import normalize_request
from docking_service.service import DockingService
from docking_service.settings import EngineConfig, Settings


def test_replay_uses_supported_fixture_through_cache(tmp_path: Path) -> None:
    settings = Settings(cache_dir=tmp_path, engine_name="replay", engine=EngineConfig())
    service = DockingService.for_engine(settings, ReplayEngine(), DockingMetrics())
    request = normalize_request(
        pdbid="1cx7",
        smiles="Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C",
        metrics=DockingMetrics(),
    )

    response = service.dock(request)

    assert response.pdb
    assert response.sdf.count("$$$$") == 5
    assert response.sdf.count(">  <smiles>  (1) ") == 5
    assert (tmp_path / "receptors" / "1cx7" / "META.json").is_file()


def test_replay_refuses_unknown_fixture_request(tmp_path: Path) -> None:
    settings = Settings(cache_dir=tmp_path, engine_name="replay", engine=EngineConfig())
    service = DockingService.for_engine(settings, ReplayEngine(), DockingMetrics())
    request = normalize_request(pdbid="8abc", smiles="CC", metrics=DockingMetrics())

    with pytest.raises(UnsupportedFixtureError):
        service.dock(request)
