from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from docking_service.api import create_app
from docking_service.errors import PdbFormatUnavailable
from docking_service.settings import EngineConfig, Settings


ENCODED_SMILES = "Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C"
DECODED_SMILES = "Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C"


def _settings(cache_dir: Path, engine_name: str = "replay") -> Settings:
    return Settings(cache_dir=cache_dir, engine_name=engine_name, engine=EngineConfig())


@pytest.fixture
def replay_client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(_settings(tmp_path)), raise_server_exceptions=False)


def test_post_and_legacy_raw_path_replay_the_offline_pipeline(replay_client: TestClient) -> None:
    post = replay_client.post("/docking", json={"pdbID": "1CX7", "smiles": ENCODED_SMILES})
    assert post.status_code == 200
    assert set(post.json()) == {"pdb", "sdf"}
    assert post.json()["sdf"].count("$$$$") == 5

    # TestClient preserves this escaped raw path. The service must not use FastAPI's decoded path.
    legacy = replay_client.get(f"/docking/1CX7&{ENCODED_SMILES}")
    assert legacy.status_code == 200
    assert legacy.json() == post.json()
    assert (replay_client.app.state.service._cache.root / "1cx7" / "source.pdb").is_file()


def test_post_accepts_lowercase_pdb_alias_and_rejects_conflicting_aliases(replay_client: TestClient) -> None:
    accepted = replay_client.post("/docking", json={"pdbid": "8abc", "smiles": "CC"})
    # Input normalization accepts the harmless alias; replay subsequently rejects unknown fixtures.
    assert accepted.status_code == 400
    assert "replay fixture" in accepted.json()["error"]

    conflict = replay_client.post(
        "/docking", json={"pdbID": "1cx7", "pdbid": "2xyz", "smiles": "CC"}
    )
    assert conflict.status_code == 400
    assert conflict.json() == {"error": "invalid docking request"}


@pytest.mark.parametrize("separator,counter", [(";", "rejected_multi_input_semicolon"), (",", "rejected_multi_input_comma")])
def test_rejects_and_counts_transformed_multi_input_separators(
    replay_client: TestClient, separator: str, counter: str
) -> None:
    response = replay_client.post("/docking", json={"pdbID": "1cx7", "smiles": f"CC{separator}O"})
    assert response.status_code == 400
    assert "exactly one molecule" in response.json()["error"]
    assert replay_client.app.state.metrics.snapshot()[counter] == 1


def test_rejects_malformed_legacy_path(replay_client: TestClient) -> None:
    response = replay_client.get("/docking/1cx7%26CC")
    assert response.status_code == 400
    assert "pdbID&smiles" in response.json()["error"]


def test_pdb_format_404_explains_that_entry_may_be_mmcif_only(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    class FormatUnavailableService:
        def dock(self, _request: object) -> object:
            raise PdbFormatUnavailable()

    monkeypatch.setattr(
        "docking_service.api.DockingService.for_engine",
        lambda *_args: FormatUnavailableService(),
    )
    client = TestClient(create_app(_settings(tmp_path)), raise_server_exceptions=False)
    response = client.post("/docking", json={"pdbID": "1cx7", "smiles": "CC"})
    assert response.status_code == 404
    assert response.json() == {"error": "PDB-format unavailable or entry missing, possibly mmCIF-only"}


@pytest.mark.parametrize(
    "payload",
    [
        {"pdbID": "1cx7", "smiles": "not chemistry"},
        {"pdbID": "1cx7", "smiles": "CC", "simulationKey": "forbidden"},
    ],
)
def test_invalid_or_extra_request_data_is_never_a_chargeable_success(
    replay_client: TestClient, payload: dict[str, str]
) -> None:
    response = replay_client.post("/docking", json=payload)
    assert response.status_code == 400
    assert set(response.json()) == {"error"}
    assert response.json()["error"].strip()


def test_autodock_gpu_is_unhealthy_and_returns_a_preparation_free_503(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path, "autodock-gpu")), raise_server_exceptions=False)
    health = client.get("/health")
    response = client.post("/docking", json={"pdbID": "1cx7", "smiles": "CC"})
    assert health.status_code == 503
    assert response.status_code == 503
    assert "hardware qualification" in response.json()["error"]
    assert not (tmp_path / "receptors").exists()
