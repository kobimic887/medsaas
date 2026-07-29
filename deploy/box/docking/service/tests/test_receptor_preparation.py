from __future__ import annotations

from pathlib import Path

from docking_service.models import NormalizedRequest
from docking_service.receptor import (
    FixedRcsbClient,
    ReplayReceptorPreparer,
    _heavy_coordinate_map,
    _parse_and_validate_source,
)
from docking_service.settings import ReceptorConfig


def test_prepared_1cx7_preserves_every_rcsb_heavy_atom_exactly(tmp_path: Path) -> None:
    source = FixedRcsbClient.for_1cx7().fetch_pdb("1cx7")
    source_atoms = [
        atom
        for atom in _parse_and_validate_source(source)
        if atom.record == "ATOM"
    ]
    source_heavy = _heavy_coordinate_map(source_atoms)
    request = NormalizedRequest(pdbid="1cx7", smiles="CC", smiles_sha256="fixture")

    prepared = ReplayReceptorPreparer(ReceptorConfig()).prepare(request, tmp_path)

    output_atoms = [
        atom
        for atom in _parse_and_validate_source(prepared.pdb)
        if atom.record == "ATOM"
    ]
    output_heavy = _heavy_coordinate_map(output_atoms)
    shared = set(source_heavy) & set(output_heavy)
    additions = set(output_heavy) - set(source_heavy)
    max_deviation = max(
        max(
            abs(actual - expected)
            for actual, expected in zip(output_heavy[key], source_heavy[key], strict=True)
        )
        for key in shared
    )

    assert len(source_heavy) == 1289
    assert len(output_heavy) == 1290
    assert len(shared) == 1289
    assert max_deviation == 0.0
    assert len(additions) == 1
    assert next(iter(additions))[-1] == "OXT"
    assert "HETATM" not in prepared.pdb
    assert prepared.pdb.rstrip().endswith("END")

    atom_lines = [line for line in prepared.pdb.splitlines() if line.startswith("ATOM")]
    assert atom_lines
    assert all(line[54:60].strip() == "1.00" for line in atom_lines)
    assert all(line[60:66].strip() == "0.00" for line in atom_lines)
