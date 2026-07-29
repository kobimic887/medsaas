"""Black-box API tests for the local convertSTR service."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient
from rdkit import Chem

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as convertstr  # noqa: E402


ASPIRIN = "CC(=O)Oc1ccccc1C(=O)O"


@pytest.fixture
def client() -> TestClient:
    with TestClient(convertstr.app, raise_server_exceptions=False) as test_client:
        yield test_client


def assert_error(response, expected_statuses: set[int]) -> None:
    assert response.status_code != 200
    assert response.status_code in expected_statuses
    assert isinstance(response.json().get("error"), str)
    assert response.json()["error"]


def parse_sdf(sdf: str) -> Chem.Mol:
    molecule = next(
        convertstr.forward_sd_mol_supplier(
            BytesIO(sdf.encode("utf-8")), sanitize=True, removeHs=False
        ),
        None,
    )
    assert molecule is not None
    return molecule


def test_health(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_aspirin_round_trip_has_explicit_hydrogens_and_real_3d_sdf(
    client: TestClient,
) -> None:
    response = client.post("/convertSTR", json={"smiles": ASPIRIN})

    assert response.status_code == 200
    assert set(response.json()) == {"sdf"}
    sdf = response.json()["sdf"]
    assert "\r" not in sdf
    assert sdf.endswith("\n$$$$\n")
    assert sdf.count("$$$$") == 1

    molecule = parse_sdf(sdf)
    expected_smiles = Chem.MolToSmiles(Chem.MolFromSmiles(ASPIRIN), canonical=True)
    actual_smiles = Chem.MolToSmiles(Chem.RemoveHs(molecule), canonical=True)
    assert actual_smiles == expected_smiles
    assert any(atom.GetAtomicNum() == 1 for atom in molecule.GetAtoms())

    conformer = molecule.GetConformer()
    assert conformer.Is3D()
    assert any(
        abs(conformer.GetAtomPosition(index).z) > 1e-6
        for index in range(molecule.GetNumAtoms())
    )


def test_aspirin_response_is_byte_deterministic(client: TestClient) -> None:
    first = client.post("/convertSTR", json={"smiles": ASPIRIN})
    second = client.post("/convertSTR", json={"smiles": ASPIRIN})

    assert first.status_code == second.status_code == 200
    assert first.json()["sdf"].encode("utf-8") == second.json()["sdf"].encode("utf-8")


@pytest.mark.parametrize(
    ("request_kwargs", "expected_statuses"),
    [
        ({"json": {"smiles": "not a smiles"}}, {400}),
        ({"json": {}}, {422}),
        ({"json": {"smiles": ""}}, {400}),
        ({"json": {"smiles": 123}}, {422}),
        (
            {
                "content": b'{"smiles":',
                "headers": {"content-type": "application/json"},
            },
            {422},
        ),
    ],
    ids=["invalid", "missing", "blank", "non-string", "malformed-json"],
)
def test_rejects_invalid_request_bodies(
    client: TestClient, request_kwargs: dict, expected_statuses: set[int]
) -> None:
    response = client.post("/convertSTR", **request_kwargs)

    assert_error(response, expected_statuses)


@pytest.mark.parametrize(
    "padded",
    [f" {ASPIRIN}", f"{ASPIRIN} ", f"  {ASPIRIN}\n", f"\t{ASPIRIN}\r\n"],
    ids=["leading", "trailing", "both", "tab-crlf"],
)
def test_untrimmed_smiles_converts_identically(client: TestClient, padded: str) -> None:
    """The platform sends whatever the user typed.

    The very last request the old 83:8001 service received, logged 2026-06-04T12:15:34Z, was
    {"smiles": " C#Cc1ccc(cc1)C#C"} — leading space and all. Whitespace carries no meaning in
    a SMILES, so a padded string must produce byte-identical output, not an error.
    """
    clean = client.post("/convertSTR", json={"smiles": ASPIRIN})
    response = client.post("/convertSTR", json={"smiles": padded})

    assert response.status_code == 200
    assert response.json()["sdf"] == clean.json()["sdf"]


def test_whitespace_only_smiles_is_still_rejected(client: TestClient) -> None:
    """Trimming must not turn "   " into a parse error with a misleading message."""
    response = client.post("/convertSTR", json={"smiles": "   \n\t "})

    assert_error(response, {400})
    assert "empty" in response.json()["error"].lower()


def test_rejects_semicolon_smiles(client: TestClient) -> None:
    response = client.post("/convertSTR", json={"smiles": "CC;O"})

    assert_error(response, {400})
    assert "';'" in response.json()["error"]


def test_embedding_failure_is_never_a_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(convertstr, "embed_molecule", lambda *_: -1)

    response = client.post("/convertSTR", json={"smiles": ASPIRIN})

    assert_error(response, {400})


def test_missing_mmff_parameters_is_never_a_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(convertstr, "mmff_has_all_molecule_params", lambda *_: False)

    response = client.post("/convertSTR", json={"smiles": ASPIRIN})

    assert_error(response, {400})


def test_mmff_nonconvergence_is_never_a_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        convertstr,
        "mmff_optimize_molecule",
        lambda *_, **__: 1,
    )

    response = client.post("/convertSTR", json={"smiles": ASPIRIN})

    assert_error(response, {400})


def test_mmff_optimization_exception_is_never_a_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_optimization(*_: object, **__: object) -> int:
        raise RuntimeError("optimizer unavailable")

    monkeypatch.setattr(convertstr, "mmff_optimize_molecule", fail_optimization)

    response = client.post("/convertSTR", json={"smiles": ASPIRIN})

    assert_error(response, {400})


def test_serialization_failure_is_never_a_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_serialization(*_: object) -> str:
        raise RuntimeError("serializer unavailable")

    monkeypatch.setattr(convertstr, "mol_to_mol_block", fail_serialization)

    response = client.post("/convertSTR", json={"smiles": ASPIRIN})

    assert_error(response, {400})


def test_unparseable_serialized_sdf_is_never_a_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(convertstr, "_parse_sdf", lambda *_: None)

    response = client.post("/convertSTR", json={"smiles": ASPIRIN})

    assert_error(response, {400})


def test_unexpected_route_error_returns_generic_500(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_conversion(_: str) -> str:
        raise RuntimeError("internal detail must stay in logs")

    monkeypatch.setattr(convertstr, "convert_smiles", fail_conversion)

    response = client.post("/convertSTR", json={"smiles": ASPIRIN})

    assert response.status_code == 500
    assert response.json() == {"error": "Internal conversion error"}
    assert "internal detail" not in response.text
