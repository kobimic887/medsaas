from __future__ import annotations

from hashlib import sha256
from importlib.resources import files
import logging
import sys
from types import ModuleType

import pytest

from docking_service.engines.replay import ReplayEngine
from docking_service.errors import StructureError
from docking_service.receptor import (
    FixedRcsbClient,
    RcsbReceptorPreparer,
    _assert_topology_coordinate_gate,
    _atom_only_pdb,
    _heavy_coordinate_map,
    _parse_and_validate_source,
    _select_box,
)
from docking_service.settings import ReceptorConfig


RAW_1CX7_SHA256 = "686df46f0d270dc90246ee05d8c84094fc7cebbcf22772e2de7ce9970b29d286"


def _atom(
    record: str,
    serial: int,
    name: str,
    residue: str,
    chain: str,
    residue_id: int,
    x: float,
    y: float,
    z: float,
    element: str,
    altloc: str = " ",
) -> str:
    return (
        f"{record:<6}{serial:>5} {name:<4}{altloc}{residue:>3} {chain}{residue_id:>4}    "
        f"{x:>8.3f}{y:>8.3f}{z:>8.3f}  1.00  0.00          {element:>2}\n"
    )


def test_committed_raw_1cx7_fixture_has_locked_hash() -> None:
    source = files("docking_service").joinpath("assets/1cx7.pdb").read_bytes()
    assert sha256(source).hexdigest() == RAW_1CX7_SHA256


def test_1cx7_reference_preserves_heavy_coordinates_adds_only_oxt_and_has_hydrogens() -> None:
    raw = FixedRcsbClient.for_1cx7().fetch_pdb("1cx7")
    source_heavy = _heavy_coordinate_map(
        [atom for atom in _parse_and_validate_source(raw) if atom.record == "ATOM"]
    )
    prepared = ReplayEngine().reference_pdb
    lines = prepared.splitlines()
    assert lines[0].startswith("REMARK   1 CREATED WITH OPENMM 8.2, ")
    assert all(line.startswith(("REMARK", "ATOM  ", "TER", "END")) for line in lines)
    assert lines[-2].startswith("TER")
    assert lines[-1] == "END"

    output_atoms = _parse_and_validate_source(prepared)
    output_heavy = _heavy_coordinate_map([atom for atom in output_atoms if atom.record == "ATOM"])
    assert len(source_heavy) == 1289
    assert len(output_heavy) == 1290
    additions = set(output_heavy).difference(source_heavy)
    assert len(additions) == 1
    assert next(iter(additions))[-1] == "OXT"
    for identity, coordinate in source_heavy.items():
        assert output_heavy[identity] == coordinate
    assert any(atom.is_hydrogen for atom in output_atoms)
    assert {atom.chain_id for atom in output_atoms} == {"A"}
    assert all("HETATM" not in line for line in lines)
    assert all(line[54:60].strip() == "1.00" and line[60:66].strip() == "0.00" for line in lines if line.startswith("ATOM"))


def test_hed_is_selected_while_water_ions_and_additives_are_excluded() -> None:
    source = FixedRcsbClient.for_1cx7().fetch_pdb("1cx7")
    box = _select_box(_parse_and_validate_source(source), ReceptorConfig())
    assert box.ligand_resname == "HED"
    assert box.fallback_reason is None


def test_apo_structure_logs_loud_warning_and_uses_blind_protein_box(caplog: pytest.LogCaptureFixture) -> None:
    source = "".join(
        [
            _atom("ATOM", 1, "N", "ALA", "A", 1, 0, 0, 0, "N"),
            _atom("ATOM", 2, "CA", "ALA", "A", 1, 2, 4, 6, "C"),
            _atom("HETATM", 3, "O", "HOH", "A", 2, 100, 100, 100, "O"),
            "END\n",
        ]
    )
    with caplog.at_level(logging.WARNING):
        box = _select_box(_parse_and_validate_source(source), ReceptorConfig())
    assert box.ligand_resname is None
    assert box.fallback_reason is not None
    assert "APO_RECEPTOR_FALLBACK" in caplog.text
    assert box.size == (18.0, 20.0, 22.0)


def test_multichain_source_retains_chain_identity_for_ligand_selection() -> None:
    source = "".join(
        [
            _atom("ATOM", 1, "N", "ALA", "A", 1, 0, 0, 0, "N"),
            _atom("ATOM", 2, "CA", "ALA", "B", 1, 1, 1, 1, "C"),
            _atom("HETATM", 3, "C1", "HED", "B", 7, 8, 9, 10, "C"),
            _atom("HETATM", 4, "O1", "HED", "B", 7, 10, 11, 12, "O"),
            "END\n",
        ]
    )
    atoms = _parse_and_validate_source(source)
    assert {atom.chain_id for atom in atoms} == {"A", "B"}
    assert _select_box(atoms, ReceptorConfig()).ligand_resname == "HED"


@pytest.mark.parametrize(
    "source,expected",
    [
        (_atom("ATOM", 1, "N", "ALA", "A", 1, 0, 0, 0, "N", altloc="A") + "END\n", "alternate"),
        ("MODEL        1\n" + _atom("ATOM", 1, "N", "ALA", "A", 1, 0, 0, 0, "N") + "ENDMDL\nEND\n", "MODEL"),
    ],
)
def test_rejects_ambiguous_altloc_and_model_sources(source: str, expected: str) -> None:
    with pytest.raises(StructureError, match=expected):
        _parse_and_validate_source(source)


class _FakeElement:
    def __init__(self, symbol: str) -> None:
        self.symbol = symbol


class _FakeChain:
    def __init__(self, chain_id: str) -> None:
        self.id = chain_id


class _FakeResidue:
    def __init__(self, chain_id: str, residue_id: str, name: str, insertion_code: str = "") -> None:
        self.chain = _FakeChain(chain_id)
        self.id = residue_id
        self.insertionCode = insertion_code
        self.name = name


class _FakeAtom:
    def __init__(self, residue: _FakeResidue, name: str, element: str, index: int) -> None:
        self.residue = residue
        self.name = name
        self.element = _FakeElement(element)
        self.index = index


class _FakePosition:
    def __init__(self, x: float, y: float, z: float) -> None:
        self._coords = (x, y, z)

    def value_in_unit(self, _unit: object) -> tuple[float, float, float]:
        return self._coords


class _FakeUnit:
    angstrom = "angstrom"


def test_topology_identity_distinguishes_residue_1_from_10_and_102() -> None:
    from docking_service.receptor import _topology_identity

    r1 = _FakeResidue("A", "1", "ALA")
    r10 = _FakeResidue("A", "10", "ALA")
    r102 = _FakeResidue("A", "102", "ALA")
    a1 = _FakeAtom(r1, "N", "N", 0)
    a10 = _FakeAtom(r10, "N", "N", 1)
    a102 = _FakeAtom(r102, "N", "N", 2)
    assert _topology_identity(a1) != _topology_identity(a10)
    assert _topology_identity(a1) != _topology_identity(a102)
    assert _topology_identity(a10) != _topology_identity(a102)


def test_topology_identity_preserves_insertion_code_exactly() -> None:
    from docking_service.receptor import _topology_identity

    base = _FakeResidue("A", "42", "ALA", "")
    with_a = _FakeResidue("A", "42", "ALA", "A")
    with_b = _FakeResidue("A", "42", "ALA", "B")
    assert _topology_identity(_FakeAtom(base, "N", "N", 0)) != _topology_identity(_FakeAtom(with_a, "N", "N", 1))
    assert _topology_identity(_FakeAtom(with_a, "N", "N", 0)) != _topology_identity(_FakeAtom(with_b, "N", "N", 1))


def test_coordinate_gate_catches_residue_id_prefix_collision() -> None:
    r1 = _FakeResidue("A", "1", "ALA")
    r10 = _FakeResidue("A", "10", "ALA")
    atoms = [_FakeAtom(r1, "N", "N", 0), _FakeAtom(r10, "CA", "C", 1)]

    class FakeTopology:
        def atoms(self) -> list[_FakeAtom]:
            return atoms

    positions = [_FakePosition(1.0, 2.0, 3.0), _FakePosition(4.0, 5.0, 6.0)]
    source = {("A", "1", "", "ALA", "N"): (1.0, 2.0, 3.0), ("A", "10", "", "ALA", "CA"): (4.0, 5.0, 6.0)}
    _assert_topology_coordinate_gate(FakeTopology(), positions, source, _FakeUnit())

    wrong_source = {("A", "1", "", "ALA", "N"): (1.0, 2.0, 3.0), ("A", "10", "", "ALA", "CA"): (99.0, 99.0, 99.0)}
    with pytest.raises(StructureError, match="moved"):
        _assert_topology_coordinate_gate(FakeTopology(), positions, wrong_source, _FakeUnit())


def test_coordinate_gate_preserves_original_heavy_atoms_at_zero_deviation() -> None:
    r1 = _FakeResidue("A", "1", "ALA")
    atoms = [_FakeAtom(r1, "N", "N", 0), _FakeAtom(r1, "H", "H", 1)]

    class FakeTopology:
        def atoms(self) -> list[_FakeAtom]:
            return atoms

    positions = [_FakePosition(10.0, 20.0, 30.0), _FakePosition(0.0, 0.0, 0.0)]
    source = {("A", "1", "", "ALA", "N"): (10.0, 20.0, 30.0)}
    _assert_topology_coordinate_gate(FakeTopology(), positions, source, _FakeUnit())


def test_atom_only_pdb_strips_hetatm_and_preserves_ter_between_protein_segments() -> None:
    source = (
        "ATOM      1  N   ALA A   1      10.000  20.000  30.000  1.00  0.00           N\n"
        "ATOM      2  CA  ALA A   1      11.000  21.000  31.000  1.00  0.00           C\n"
        "TER       3      ALA A   1\n"
        "HETATM    4  O   HOH A   2     100.000 100.000 100.000  1.00  0.00           O\n"
        "ATOM      5  N   GLY A   3      20.000  30.000  40.000  1.00  0.00           N\n"
        "TER       6      GLY A   3\n"
        "END\n"
    )
    result = _atom_only_pdb(source)
    lines = result.strip().split("\n")
    assert lines[0].startswith("ATOM")
    assert lines[1].startswith("ATOM")
    assert lines[2].startswith("TER")
    assert lines[3].startswith("ATOM")
    assert lines[4] == "END"
    assert "HETATM" not in result


def test_atom_only_pdb_skips_ter_without_preceding_atoms() -> None:
    source = (
        "TER\n"
        "ATOM      1  N   ALA A   1      10.000  20.000  30.000  1.00  0.00           N\n"
        "TER       2      ALA A   1\n"
        "TER\n"
        "END\n"
    )
    result = _atom_only_pdb(source)
    lines = result.strip().split("\n")
    assert lines[0].startswith("ATOM")
    assert lines[1].startswith("TER")
    assert lines[2] == "END"
    assert result.count("TER") == 1


def test_missing_nonterminal_heavy_atoms_are_rejected_before_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeFixer:
        def __init__(self, pdbfile: object) -> None:
            del pdbfile
            self.missingResidues: dict[object, object] = {}
            self.missingAtoms = {object(): ["CB"]}
            self.missingTerminals: dict[object, object] = {}

        def findMissingResidues(self) -> None:
            return None

        def findMissingAtoms(self) -> None:
            return None

    openmm = ModuleType("openmm")
    openmm.unit = object()  # type: ignore[attr-defined]
    openmm_app = ModuleType("openmm.app")
    openmm_app.PDBFile = object()  # type: ignore[attr-defined]
    pdbfixer = ModuleType("pdbfixer")
    pdbfixer.PDBFixer = FakeFixer  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "openmm", openmm)
    monkeypatch.setitem(sys.modules, "openmm.app", openmm_app)
    monkeypatch.setitem(sys.modules, "pdbfixer", pdbfixer)

    preparer = RcsbReceptorPreparer(FixedRcsbClient.for_1cx7(), ReceptorConfig())
    with pytest.raises(StructureError, match="missing non-terminal heavy"):
        preparer._fix_and_write("ATOM\nEND\n", {})
