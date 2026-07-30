from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from diffdock_service.api import create_app
from diffdock_service.settings import Settings

REFERENCE = Path(__file__).resolve().parents[1] / "reference"


def load_reference(name: str) -> dict:
    return json.loads((REFERENCE / name).read_text(encoding="utf-8"))


@pytest.fixture()
def replay_settings(tmp_path: Path) -> Settings:
    return Settings(
        engine_name="replay",
        repo_dir=tmp_path / "repo",
        model_dir=tmp_path / "models",
        work_dir=tmp_path / "work",
        convertstr_url="",
        python_executable="python",
    )


@pytest.fixture()
def client(replay_settings: Settings) -> TestClient:
    return TestClient(create_app(replay_settings))


@pytest.fixture()
def canonical_request() -> dict:
    return load_reference("request-canonical.json")["request"]
