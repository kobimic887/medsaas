from __future__ import annotations

import pytest

from docking_service.settings import Settings


def test_environment_exposes_all_engine_qualification_tunables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    values = {
        "VINA_SCORING_FUNCTION": "vinardo",
        "VINA_FORCE_EVEN_VOXELS": "false",
        "VINA_NO_REFINE": "0",
        "REPRODUCE_TORSDO_BUG": "no",
        "VINA_MAX_EVALS": "12",
        "DEFAULT_TORSDOF": "3",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)

    settings = Settings.from_environment()

    assert settings.engine.scoring_function == "vinardo"
    assert settings.engine.force_even_voxels is False
    assert settings.engine.no_refine is False
    assert settings.engine.reproduce_torsdo_bug is False
    assert settings.engine.max_evals == 12
    assert settings.engine.default_torsdof == 3


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("VINA_FORCE_EVEN_VOXELS", "sometimes", "boolean"),
        ("VINA_SCORING_FUNCTION", "ad4", "vina or vinardo"),
        ("DEFAULT_TORSDOF", "-1", "nonnegative"),
    ],
)
def test_invalid_tunables_fail_startup(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    value: str,
    message: str,
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=message):
        Settings.from_environment()
