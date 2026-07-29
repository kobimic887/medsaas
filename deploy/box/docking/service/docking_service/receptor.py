from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from importlib.resources import files
from io import StringIO
import logging
from pathlib import Path
from typing import Protocol

import httpx

from .errors import PdbFormatUnavailable, RcsbFailure, StructureError, UnsupportedFixtureError
from .models import Box, NormalizedRequest, PreparedReceptor
from .settings import PREP_VERSION, ReceptorConfig

logger = logging.getLogger(__name__)

# Deliberately visible.  These groups cannot establish the holo docking box.
# Monatomic ions, waters, buffers, cryoprotectants, precipitants and common additives are excluded.
COCRYSTAL_EXCLUSION_RESNAMES = frozenset(
    {
        "HOH", "WAT", "DOD", "H2O", "CL", "BR", "I", "F", "NA", "K", "LI", "RB",
        "CS", "MG", "MN", "CA", "ZN", "FE", "CU", "CO", "NI", "CD", "HG", "SR",
        "BA", "SO4", "PO4", "NO3", "CO3", "ACT", "ACE", "FMT", "GOL", "EDO", "MPD",
        "PEG", "PG4", "PGE", "DMS", "DMSO", "EOH", "IPA", "BME", "MES", "HEP", "TRS",
        "TRIS", "CIT", "TAR", "MAL", "SUC", "NAG", "MAN", "BGC", "GLC", "XYP", "GAL",
    }
)
STANDARD_RESIDUES = frozenset(
    {
        "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE", "LEU",
        "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
    }
)


@dataclass(frozen=True, slots=True)
class _PdbAtom:
    record: str
    raw: str
    atom_name: str
    altloc: str
    residue_name: str
    chain_id: str
    residue_id: str
    insertion_code: str
    x: float
    y: float
    z: float
    element: str

    @property
    def identity(self) -> tuple[str, str, str, str, str]:
        return (self.chain_id, self.residue_id, self.insertion_code, self.residue_name, self.atom_name)

    @property
    def is_hydrogen(self) -> bool:
        element = self.element.upper()
        return element == "H" or (not element and self.atom_name.upper().startswith("H"))


class RcsbClient(Protocol):
    def fetch_pdb(self, pdbid: str) -> str: ...


class HttpRcsbClient:
    def __init__(self, timeout_seconds: float, max_source_bytes: int) -> None:
        self._timeout_seconds = timeout_seconds
        self._max_source_bytes = max_source_bytes

    def fetch_pdb(self, pdbid: str) -> str:
        url = f"https://files.rcsb.org/download/{pdbid.upper()}.pdb"
        try:
            with httpx.Client(timeout=self._timeout_seconds, follow_redirects=False) as client:
                response = client.get(url, headers={"Accept": "chemical/x-pdb,text/plain"})
        except httpx.TimeoutException as exc:
            raise RcsbFailure("RCSB receptor download timed out") from exc
        except httpx.HTTPError as exc:
            raise RcsbFailure("RCSB receptor download could not be completed") from exc
        if response.status_code == 404:
            raise PdbFormatUnavailable()
        if response.status_code != 200:
            raise RcsbFailure(f"RCSB receptor download returned HTTP {response.status_code}")
        if len(response.content) > self._max_source_bytes:
            raise StructureError("RCSB PDB source exceeds the supported size")
        try:
            return response.content.decode("ascii", errors="strict")
        except UnicodeDecodeError as exc:
            raise StructureError("RCSB did not return an ASCII PDB-format file") from exc


class FixedRcsbClient:
    """Network-free, committed RCSB source used by the replay backend only."""

    def __init__(self, pdbid: str, source: str) -> None:
        self._pdbid = pdbid.lower()
        self._source = source

    @classmethod
    def for_1cx7(cls) -> "FixedRcsbClient":
        source = files("docking_service").joinpath("assets/1cx7.pdb").read_text(encoding="ascii")
        return cls("1cx7", source)

    def fetch_pdb(self, pdbid: str) -> str:
        if pdbid.lower() != self._pdbid:
            raise UnsupportedFixtureError()
        return self._source


class ReceptorPreparer(Protocol):
    def prepare(self, request: NormalizedRequest, destination: Path) -> PreparedReceptor: ...


class RcsbReceptorPreparer:
    """Strict RCSB -> PDBFixer/OpenMM -> Meeko receptor preparation.

    Input heavy atoms are captured before PDBFixer and gated after OXT, hydrogenation and PDB
    serialization. PDBFixer's public local minimizers freeze existing atoms at mass zero; any
    movement nevertheless fails these gates rather than becoming a silent preparation change.
    """

    def __init__(self, client: RcsbClient, config: ReceptorConfig) -> None:
        self._client = client
        self._config = config

    def prepare(self, request: NormalizedRequest, destination: Path) -> PreparedReceptor:
        source = self._client.fetch_pdb(request.pdbid)
        (destination / "source.pdb").write_text(source, encoding="ascii")
        atoms = _parse_and_validate_source(source)
        source_atoms = [atom for atom in atoms if atom.record == "ATOM"]
        heavy_source = _heavy_coordinate_map(source_atoms)
        selected_box = _select_box(atoms, self._config)

        # HETATM is intentionally retained through selection, then wholly excluded before fixing.
        # Keep TER records so PDBFixer cannot merge protein segments that reuse one chain ID.
        atom_only = _atom_only_pdb(source)
        prepared_pdb = self._fix_and_write(atom_only, heavy_source)
        receptor = destination / "receptor.pdb"
        receptor.write_text(prepared_pdb, encoding="ascii")
        _assert_written_coordinate_gate(prepared_pdb, heavy_source)

        receptor_pdbqt = destination / "receptor.pdbqt"
        pdbqt = _write_receptor_pdbqt(prepared_pdb, heavy_source)
        receptor_pdbqt.write_text(pdbqt, encoding="utf-8")
        box_file = destination / "box.json"
        box_file.write_text(
            _box_json(selected_box),
            encoding="utf-8",
        )
        return PreparedReceptor(
            pdb=prepared_pdb,
            receptor_pdbqt=receptor_pdbqt,
            box=selected_box,
            metadata={
                "source_sha256": sha256(source.encode("ascii")).hexdigest(),
                "rcsb_fetched_at": datetime.now(UTC).isoformat(),
                "prep_version": PREP_VERSION,
                "selected_ligand": selected_box.ligand_resname,
                "apo_fallback_reason": selected_box.fallback_reason,
            },
        )

    def _fix_and_write(
        self,
        atom_only: str,
        heavy_source: dict[tuple[str, str, str, str, str], tuple[float, float, float]],
    ) -> str:
        from openmm import unit
        from openmm.app import PDBFile
        from pdbfixer import PDBFixer

        fixer = PDBFixer(pdbfile=StringIO(atom_only))
        fixer.findMissingResidues()
        fixer.missingResidues = {}
        fixer.findMissingAtoms()
        if fixer.missingAtoms:
            raise StructureError("receptor has missing non-terminal heavy atoms")
        unexpected_terminals = [
            atom_name
            for terminal_names in fixer.missingTerminals.values()
            for atom_name in terminal_names
            if atom_name != "OXT"
        ]
        if unexpected_terminals:
            raise StructureError("receptor requires unsupported terminal heavy-atom repair")
        # The preceding missingAtoms gate means public addMissingAtoms can add only approved OXT.
        fixer.addMissingAtoms(seed=self._config.pdbfixer_seed)
        _assert_topology_coordinate_gate(fixer.topology, fixer.positions, heavy_source, unit)
        _assert_only_oxt_added(fixer.topology, heavy_source)

        fixer.addMissingHydrogens(pH=self._config.ph)
        _assert_topology_coordinate_gate(fixer.topology, fixer.positions, heavy_source, unit)
        _assert_only_oxt_added(fixer.topology, heavy_source)

        output = StringIO()
        PDBFile.writeFile(fixer.topology, fixer.positions, output, keepIds=True)
        records = [line for line in output.getvalue().splitlines() if not line.startswith("CRYST1")]
        date = datetime.now(UTC).date().isoformat()
        return f"REMARK   1 CREATED WITH OPENMM 8.2, {date}\n" + "\n".join(records) + "\n"


class ReplayReceptorPreparer(RcsbReceptorPreparer):
    """Normal receptor/cache pipeline backed by the committed raw PDB fixture."""

    def __init__(self, config: ReceptorConfig) -> None:
        super().__init__(FixedRcsbClient.for_1cx7(), config)


def _parse_and_validate_source(source: str) -> list[_PdbAtom]:
    if not source.endswith("\n"):
        source += "\n"
    atoms: list[_PdbAtom] = []
    identities: set[tuple[str, str, str, str, str]] = set()
    for line in source.splitlines():
        record = line[:6].strip()
        if record in {"MODEL", "ENDMDL"}:
            # A MODEL record makes coordinate selection ambiguous even if this PDB happens
            # to contain only one model. Strict preparation accepts a single coordinate set.
            raise StructureError("PDB MODEL records are unsupported")
        if record not in {"ATOM", "HETATM"}:
            continue
        if len(line) < 54:
            raise StructureError("PDB coordinate record is too short")
        try:
            atom = _PdbAtom(
                record=record,
                raw=line,
                atom_name=line[12:16].strip(),
                altloc=line[16:17],
                residue_name=line[17:20].strip().upper(),
                chain_id=line[21:22],
                residue_id=line[22:26].strip(),
                insertion_code=line[26:27],
                x=float(line[30:38]),
                y=float(line[38:46]),
                z=float(line[46:54]),
                element=line[76:78].strip() if len(line) >= 78 else "",
            )
        except ValueError as exc:
            raise StructureError("PDB contains malformed fixed-column coordinates") from exc
        if not atom.atom_name or not atom.residue_name or not atom.residue_id:
            raise StructureError("PDB contains unsupported blank atom or residue identifiers")
        if atom.altloc.strip():
            raise StructureError("PDB contains ambiguous nonblank alternate locations")
        if atom.record == "ATOM" and atom.residue_name not in STANDARD_RESIDUES:
            raise StructureError("PDB contains unsupported nonstandard ATOM residue")
        if atom.identity in identities:
            raise StructureError("PDB contains duplicate atom identities")
        identities.add(atom.identity)
        atoms.append(atom)
    if not any(atom.record == "ATOM" and not atom.is_hydrogen for atom in atoms):
        raise StructureError("PDB contains no receptor heavy atoms")
    return atoms


def _atom_only_pdb(source: str) -> str:
    """Strip HETATM while retaining TER boundaries between protein segments."""
    records: list[str] = []
    atoms_since_ter = False
    for line in source.splitlines():
        record = line[:6].strip()
        if record == "ATOM":
            records.append(line)
            atoms_since_ter = True
        elif record == "TER" and atoms_since_ter:
            records.append(line)
            atoms_since_ter = False
    records.append("END")
    return "\n".join(records) + "\n"


def _heavy_coordinate_map(atoms: list[_PdbAtom]) -> dict[tuple[str, str, str, str, str], tuple[float, float, float]]:
    values = {atom.identity: (atom.x, atom.y, atom.z) for atom in atoms if not atom.is_hydrogen}
    if not values:
        raise StructureError("PDB contains no receptor heavy atoms")
    return values


def _select_box(atoms: list[_PdbAtom], config: ReceptorConfig) -> Box:
    groups: dict[tuple[str, str, str, str], list[_PdbAtom]] = {}
    for atom in atoms:
        if atom.record != "HETATM" or atom.residue_name in COCRYSTAL_EXCLUSION_RESNAMES:
            continue
        if atom.is_hydrogen:
            continue
        key = (atom.chain_id, atom.residue_id, atom.insertion_code, atom.residue_name)
        groups.setdefault(key, []).append(atom)
    eligible = [(key, group) for key, group in groups.items() if len(group) > 1]
    if eligible:
        key, ligand = max(eligible, key=lambda item: (len(item[1]), item[0]))
        center = tuple(sum(getattr(atom, axis) for atom in ligand) / len(ligand) for axis in ("x", "y", "z"))
        return Box(center=center, size=config.holo_box_size, ligand_resname=key[3])

    protein = [atom for atom in atoms if atom.record == "ATOM" and not atom.is_hydrogen]
    lows = tuple(min(getattr(atom, axis) for atom in protein) - config.apo_padding for axis in ("x", "y", "z"))
    highs = tuple(max(getattr(atom, axis) for atom in protein) + config.apo_padding for axis in ("x", "y", "z"))
    center = tuple((low + high) / 2 for low, high in zip(lows, highs, strict=True))
    size = tuple(high - low for low, high in zip(lows, highs, strict=True))
    reason = "no eligible non-water, non-ion co-crystal ligand; using whole-protein apo box"
    logger.warning("APO_RECEPTOR_FALLBACK %s", reason)
    return Box(center=center, size=size, fallback_reason=reason)


def _topology_identity(atom: object) -> tuple[str, str, str, str, str]:
    residue = atom.residue
    insertion_code = str(getattr(residue, "insertionCode", "") or "")
    return (
        str(residue.chain.id),
        str(residue.id),
        insertion_code,
        str(residue.name),
        str(atom.name),
    )


def _topology_heavy_coordinates(topology: object, positions: object, unit: object) -> dict[tuple[str, str, str, str, str], tuple[float, float, float]]:
    result: dict[tuple[str, str, str, str, str], tuple[float, float, float]] = {}
    for atom in topology.atoms():
        element = getattr(atom, "element", None)
        if element is not None and element.symbol.upper() == "H":
            continue
        key = _topology_identity(atom)
        position = positions[atom.index].value_in_unit(unit.angstrom)
        if key in result:
            raise StructureError("PDBFixer produced duplicate heavy-atom identities")
        result[key] = (float(position[0]), float(position[1]), float(position[2]))
    return result


def _assert_topology_coordinate_gate(topology: object, positions: object, source: dict[tuple[str, str, str, str, str], tuple[float, float, float]], unit: object) -> None:
    actual = _topology_heavy_coordinates(topology, positions, unit)
    for key, source_coordinate in source.items():
        coordinate = actual.get(key)
        if coordinate is None or max(abs(a - b) for a, b in zip(coordinate, source_coordinate, strict=True)) > 1e-9:
            raise StructureError("PDBFixer moved, dropped, or ambiguously changed an original heavy atom")


def _assert_only_oxt_added(topology: object, source: dict[tuple[str, str, str, str, str], tuple[float, float, float]]) -> None:
    for atom in topology.atoms():
        element = getattr(atom, "element", None)
        if element is not None and element.symbol.upper() == "H":
            continue
        identity = _topology_identity(atom)
        if identity not in source and atom.name != "OXT":
            raise StructureError("PDBFixer added a non-OXT heavy atom")


def _assert_written_coordinate_gate(pdb: str, source: dict[tuple[str, str, str, str, str], tuple[float, float, float]]) -> None:
    output_atoms = _parse_and_validate_source(pdb)
    output_heavy = _heavy_coordinate_map([atom for atom in output_atoms if atom.record == "ATOM"])
    unexpected = [key for key in output_heavy if key not in source and key[-1] != "OXT"]
    if unexpected:
        raise StructureError("prepared PDB contains an unexpected added heavy atom")
    for key, coordinate in source.items():
        actual = output_heavy.get(key)
        if actual is None or max(abs(a - b) for a, b in zip(actual, coordinate, strict=True)) > 0.00051:
            raise StructureError("prepared PDB did not preserve original heavy coordinates")


def _write_receptor_pdbqt(pdb: str, source_heavy: dict[tuple[str, str, str, str, str], tuple[float, float, float]]) -> str:
    try:
        from meeko import MoleculePreparation, PDBQTWriterLegacy, Polymer, ResidueChemTemplates
        templates = ResidueChemTemplates.create_from_defaults()
        polymer = Polymer.from_pdb_string(
            pdb,
            templates,
            MoleculePreparation(),
            allow_bad_res=False,
        )
        rigid, flex_by_residue = PDBQTWriterLegacy.write_from_polymer(polymer)
    except Exception as exc:
        raise StructureError("Meeko could not prepare a strict rigid receptor PDBQT") from exc
    if flex_by_residue:
        raise StructureError("Meeko produced unsupported flexible receptor residues")
    if not rigid:
        raise StructureError("Meeko produced an empty receptor PDBQT")
    _assert_pdbqt_heavy_coordinates(rigid, source_heavy)
    return rigid


def _assert_pdbqt_heavy_coordinates(pdbqt: str, source: dict[tuple[str, str, str, str, str], tuple[float, float, float]]) -> None:
    actual: list[tuple[float, float, float]] = []
    for line in pdbqt.splitlines():
        if not line.startswith(("ATOM", "HETATM")):
            continue
        atom_name = line[12:16].strip().upper()
        if atom_name.startswith("H"):
            continue
        try:
            actual.append((float(line[30:38]), float(line[38:46]), float(line[46:54])))
        except ValueError as exc:
            raise StructureError("Meeko produced malformed PDBQT coordinates") from exc
    if len(actual) < len(source):
        raise StructureError("Meeko dropped original receptor heavy atoms")
    for coordinate in source.values():
        if not any(max(abs(a - b) for a, b in zip(candidate, coordinate, strict=True)) <= 0.0011 for candidate in actual):
            raise StructureError("Meeko changed or dropped an original receptor heavy coordinate")


def _box_json(box: Box) -> str:
    import json

    return json.dumps(
        {
            "center": box.center,
            "size": box.size,
            "ligand_resname": box.ligand_resname,
            "apo_fallback_reason": box.fallback_reason,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
