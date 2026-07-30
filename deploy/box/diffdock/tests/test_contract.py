from __future__ import annotations

import pytest

from .conftest import load_reference

CAPTURED_KEYS = {
    "ligand_positions",
    "trajectory",
    "position_confidence",
    "status",
    "details",
    "protein",
    "ligand",
}


def _post(client, canonical_request, **overrides):
    body = dict(canonical_request)
    body.update(overrides)
    return client.post("/molecular-docking/diffdock/generate", json=body)


def test_health_reports_the_engine(client) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "engine": "replay"}


def test_success_returns_exactly_the_captured_key_set(client, canonical_request) -> None:
    response = _post(client, canonical_request, num_poses=1)
    assert response.status_code == 200
    assert set(response.json()) == CAPTURED_KEYS


def test_failure_returns_the_same_key_set_and_http_200(client, canonical_request) -> None:
    """Failure is HTTP 200 with status "failed". Checking the status code does not detect it."""
    response = _post(client, canonical_request, ligand="not a molecule", num_poses=4)
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == CAPTURED_KEYS
    assert payload["status"] == "failed"
    assert payload["details"] == "Fail to read ligand molecule description"


def test_arrays_are_padded_to_num_poses_even_when_nothing_docked(client, canonical_request) -> None:
    """A failed dock returns 100 empty strings, not an empty array.

    This is the trap the contract calls out: a caller that trusts `ligand_positions.length`
    reports 100 poses for a dock that produced none.
    """
    response = _post(client, canonical_request, ligand="not a molecule", num_poses=100)
    payload = response.json()
    assert len(payload["ligand_positions"]) == 100
    assert len(payload["position_confidence"]) == 100
    assert len(payload["trajectory"]) == 100
    assert payload["ligand_positions"] == [""] * 100
    assert payload["position_confidence"] == [None] * 100


def test_success_short_of_num_poses_still_pads_to_length(client, canonical_request) -> None:
    """The replay engine holds four poses. Asking for ten must still return ten slots."""
    payload = _post(client, canonical_request, num_poses=10).json()
    assert payload["status"] == "success"
    assert len(payload["ligand_positions"]) == 10
    assert sum(1 for entry in payload["ligand_positions"] if entry) == 4
    assert payload["ligand_positions"][4:] == [""] * 6
    assert payload["position_confidence"][4:] == [None] * 6


def test_confidence_is_ranked_best_first_and_index_aligned(client, canonical_request) -> None:
    """The dashboard used to pair pose 0 with confidence[-1]; the order is load-bearing."""
    payload = _post(client, canonical_request, num_poses=4).json()
    scores = payload["position_confidence"]
    assert scores == sorted(scores, reverse=True)
    assert scores[0] == pytest.approx(-0.5827779769897461)
    assert all(payload["ligand_positions"][i] for i in range(4))


def test_protein_and_ligand_are_echoed_verbatim(client, canonical_request) -> None:
    """Including whatever escaping arrived — proven by the captured failure payload."""
    payload = _post(client, canonical_request, num_poses=1).json()
    assert payload["protein"] == canonical_request["protein"]
    assert payload["ligand"] == canonical_request["ligand"]


def test_details_matches_the_captured_success_string(client, canonical_request) -> None:
    payload = _post(client, canonical_request, num_poses=1).json()
    assert payload["details"] == load_reference("response-success-1pose.json")["response"]["details"]


def test_poses_carry_the_captured_sdf_shape(client, canonical_request) -> None:
    payload = _post(client, canonical_request, num_poses=1).json()
    pose = payload["ligand_positions"][0]
    assert pose.startswith("_rank1\n")
    assert pose.rstrip().endswith("$$$$")


def test_trajectory_is_empty_when_not_requested(client, canonical_request) -> None:
    payload = _post(client, canonical_request, num_poses=3, save_trajectory=False).json()
    assert payload["trajectory"] == ["", "", ""]


def test_unknown_fields_are_ignored_rather_than_rejected(client, canonical_request) -> None:
    response = _post(client, canonical_request, num_poses=1, some_future_field="x")
    assert response.status_code == 200
    assert response.json()["status"] == "success"


def test_missing_required_field_is_a_real_4xx(client, canonical_request) -> None:
    body = dict(canonical_request)
    body.pop("protein")
    response = client.post("/molecular-docking/diffdock/generate", json=body)
    assert response.status_code == 400
    assert "error" in response.json()


def test_protein_without_atom_records_is_rejected(client, canonical_request) -> None:
    response = _post(client, canonical_request, protein="HEADER only, no coordinates")
    assert response.status_code == 400


def test_num_poses_is_capped(client, canonical_request) -> None:
    payload = _post(client, canonical_request, num_poses=5000).json()
    assert len(payload["ligand_positions"]) == 100
