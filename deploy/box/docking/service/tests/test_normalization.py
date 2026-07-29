import pytest

from docking_service.errors import InputError
from docking_service.metrics import DockingMetrics
from docking_service.normalization import normalize_request, parse_legacy_path


def test_normalizes_encoded_smiles_once() -> None:
    request = normalize_request(
        pdbid="1CX7",
        smiles="Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C",
        metrics=DockingMetrics(),
    )
    assert request.pdbid == "1cx7"
    assert request.smiles == "Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C"


def test_preserves_unencoded_smiles_ring_labels_that_resemble_url_escapes() -> None:
    request = normalize_request(
        pdbid="1cx7",
        smiles="C%10CCCCC%10",
        metrics=DockingMetrics(),
    )
    assert request.smiles == "C%10CCCCC%10"


def test_decodes_url_encoded_smiles_ring_labels_once() -> None:
    request = normalize_request(
        pdbid="1cx7",
        smiles="C%2510CCCCC%2510",
        metrics=DockingMetrics(),
    )
    assert request.smiles == "C%10CCCCC%10"


def test_legacy_path_preserves_unencoded_ring_labels() -> None:
    pdbid, smiles = parse_legacy_path(b"/docking/1cx7&C%10CCCCC%10")
    assert pdbid == "1cx7"
    assert smiles == "C%10CCCCC%10"


def test_counts_both_multi_input_anomalies() -> None:
    metrics = DockingMetrics()
    with pytest.raises(InputError):
        normalize_request(pdbid="1cx7", smiles="A;B,C", metrics=metrics)
    assert metrics.snapshot() == {
        "rejected_multi_input_semicolon": 1,
        "rejected_multi_input_comma": 1,
    }


def test_parses_legacy_path_exactly_once() -> None:
    pdbid, smiles = parse_legacy_path(
        b"/docking/1cx7&Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C"
    )
    assert pdbid == "1cx7"
    assert smiles == "Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C"
