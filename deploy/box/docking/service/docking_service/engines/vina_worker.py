from __future__ import annotations

"""Native Vina worker. It is intentionally a process boundary: Vina may call exit()."""

import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import sys
from tempfile import mkdtemp
from typing import Any


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("vina worker requires one request file")
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    sys.stdout.write(json.dumps({"poses": _dock(request)}, separators=(",", ":")))


def _dock(request: dict[str, Any]) -> list[dict[str, Any]]:
    from meeko import PDBQTMolecule, RDKitMolCreate
    from rdkit import Chem
    from vina import Vina

    receptor = Path(request["receptor_pdbqt"])
    ligand = Path(request["ligand_pdbqt"])
    box = request["box"]
    cfg = request["config"]
    prefix = _ensure_maps(Vina, receptor, Path(request["maps_root"]), box, cfg)
    vina = Vina(sf_name=cfg["scoring_function"], cpu=cfg["cpu"], seed=cfg["seed"], no_refine=cfg["no_refine"], verbosity=0)
    vina.load_maps(str(prefix))
    ligand_pdbqt = ligand.read_text(encoding="utf-8")
    vina.set_ligand_from_string(ligand_pdbqt)
    vina.dock(exhaustiveness=cfg["exhaustiveness"], n_poses=cfg["expected_pose_count"], min_rmsd=cfg["min_rmsd"], max_evals=cfg["max_evals"])
    pose_pdbqt = vina.poses(n_poses=cfg["expected_pose_count"], energy_range=cfg["energy_range"])
    energies = vina.energies(n_poses=cfg["expected_pose_count"], energy_range=cfg["energy_range"])
    if len(energies) == 0 or not pose_pdbqt:
        return []
    torsdof = _torsdof(ligand_pdbqt)
    result = PDBQTMolecule(pose_pdbqt, name="ligand", poses_to_read=cfg["expected_pose_count"], energy_range=cfg["energy_range"], skip_typing=True)
    restored = RDKitMolCreate.from_pdbqt_mol(result)
    if len(restored) != 1 or restored[0] is None:
        raise RuntimeError("Meeko could not restore one docked ligand molecule")
    molecule = restored[0]
    if molecule.GetNumConformers() != len(energies):
        raise RuntimeError("Meeko restored a different number of docked conformers")
    poses: list[dict[str, Any]] = []
    for index, energy in enumerate(energies):
        score = float(energy[0])
        lines = Chem.MolToMolBlock(molecule, confId=index, forceV3000=False).splitlines()
        if len(lines) < 4 or lines[-1] != "M  END":
            raise RuntimeError("RDKit could not write a V2000 Vina pose")
        # Third field is the pose ordinal, matching the reference (0:0:0 .. 0:0:4 for five
        # poses). Vina returns poses in ascending-energy order and serialize_sdf re-sorts on
        # the same key, so this index survives serialization unchanged.
        lines[0:3] = [f"0:0:{index}", "     RDKit          3D", ""]
        poses.append({"mol_block": "\n".join(lines) + "\n", "model": str(index + 1), "torsdof": torsdof, "score": score, "score_text": f"{score:.3f}", "ligand_id": "0"})
    return poses


def _canonical(provenance: dict[str, Any]) -> dict[str, Any]:
    """Round-trip through JSON so what is compared is what was stored.

    `Box.center` and `Box.size` are **tuples** (models.py). META.json is JSON, which has no
    tuple: they are written as arrays and read back as lists. `_valid_maps` compares the
    stored value against the live one field by field, and `[0.0, 0.0, 0.0] != (0.0, 0.0, 0.0)`
    in Python — so a perfectly good, complete, checksum-matching map subcache was rejected on
    every single lookup and Vina recomputed the whole grid every time. The cache had a 0% hit
    rate from the day it was written.

    That is the expensive half of the warm path: computing all atom-type maps over a docking
    box is tens of seconds of CPU, and skipping it is the latency change a user actually
    feels (docs/NEXT-SESSION.md, "the cache itself is worth every line").

    Canonicalising here rather than at the comparison keeps one definition of the provenance
    shape. The cache key is unaffected — it is already a hash of `json.dumps(...)`, and a tuple
    and a list serialise identically — so subcaches published before this fix stay valid and
    start being *used* rather than being silently rebuilt.
    """
    return json.loads(json.dumps(provenance, sort_keys=True, separators=(",", ":")))


def _ensure_maps(vina_cls: object, receptor: Path, maps_root: Path, box: dict[str, Any], cfg: dict[str, Any]) -> Path:
    maps_root.mkdir(parents=True, exist_ok=True)
    provenance = _canonical({
        "receptor_pdbqt_sha256": _sha256(receptor), "scoring_function": cfg["scoring_function"],
        "center": box["center"], "size": box["size"], "spacing": cfg["map_spacing"],
        "force_even_voxels": cfg["force_even_voxels"], "seed": cfg["seed"], "cpu": cfg["cpu"],
        "no_refine": cfg["no_refine"], "vina_version": _vina_version(),
    })
    key = sha256(json.dumps(provenance, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    target = maps_root / key
    # Receptor entries are atomically published directories; map locks live outside them.
    locks_root = maps_root.parent.parent.parent / "locks"
    locks_root.mkdir(parents=True, exist_ok=True)
    with (locks_root / f"{maps_root.parent.name}.maps.lock").open("a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            if _valid_maps(target, provenance):
                # Recover receptor metadata if a prior process published maps but died before
                # recording their measured size/provenance in the parent cache entry.
                _record_map_subcache(maps_root, key, target)
                return target / "vina"
            temporary = Path(mkdtemp(prefix=f".{key}.", dir=maps_root))
            try:
                prefix = temporary / "vina"
                builder = vina_cls(sf_name=cfg["scoring_function"], cpu=cfg["cpu"], seed=cfg["seed"], no_refine=cfg["no_refine"], verbosity=0)
                builder.set_receptor(rigid_pdbqt_filename=str(receptor))
                # This occurs before loading any ligand, yielding all atom-type maps.
                builder.compute_vina_maps(center=list(box["center"]), box_size=list(box["size"]), spacing=cfg["map_spacing"], force_even_voxels=cfg["force_even_voxels"])
                builder.write_maps(str(prefix), overwrite=True)
                map_files = _map_files(temporary)
                if not map_files:
                    raise RuntimeError("Vina did not write any cache maps")
                (temporary / "META.json").write_text(json.dumps({**provenance, "files": {path.name: {"sha256": _sha256(path), "bytes": path.stat().st_size} for path in map_files}}, sort_keys=True, separators=(",", ":")), encoding="utf-8")
                _fsync_tree(temporary)
                _publish_map_directory(temporary, target, maps_root)
                _record_map_subcache(maps_root, key, target)
            except Exception:
                shutil.rmtree(temporary, ignore_errors=True)
                raise
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
    return target / "vina"


def _publish_map_directory(temporary: Path, target: Path, maps_root: Path) -> None:
    """Publish a complete map subcache while retaining rollback on rename/fsync failure."""
    retired = maps_root / f".{target.name}.retired.{os.getpid()}"
    moved_old = False
    published = False
    try:
        if target.exists():
            if retired.exists():
                shutil.rmtree(retired)
            os.rename(target, retired)
            moved_old = True
            _fsync_directory(maps_root)
        os.rename(temporary, target)
        published = True
        _fsync_directory(maps_root)
    except Exception:
        if published and target.exists() and not temporary.exists():
            try:
                os.rename(target, temporary)
                published = False
            except OSError:
                pass
        if moved_old and retired.exists() and not target.exists():
            os.rename(retired, target)
            _fsync_directory(maps_root)
        raise
    if moved_old and retired.exists():
        shutil.rmtree(retired, ignore_errors=True)
    for stale in maps_root.glob(f".{target.name}.retired.*"):
        if stale.exists():
            shutil.rmtree(stale, ignore_errors=True)
    _fsync_directory(maps_root)


def _record_map_subcache(maps_root: Path, key: str, target: Path) -> None:
    """Atomically record the measured Vina subcache in its receptor entry metadata."""
    metadata_path = maps_root.parent / "META.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        maps = metadata.get("maps")
        if not isinstance(maps, dict):
            maps = {}
        subcaches = maps.get("subcaches")
        if not isinstance(subcaches, dict):
            subcaches = {}
        map_metadata = json.loads((target / "META.json").read_text(encoding="utf-8"))
        measured_bytes = sum(path.stat().st_size for path in target.iterdir() if path.is_file())
        record = {
            "measured_bytes": measured_bytes,
            "metadata_sha256": _sha256(target / "META.json"),
            "files": map_metadata.get("files", {}),
        }
        if maps.get("state") == "complete" and subcaches.get(key) == record:
            return
        subcaches[key] = record
        maps["state"] = "complete"
        maps["subcaches"] = subcaches
        metadata["maps"] = maps
        # META.json describes this number, so excluding it avoids recursive accounting.
        metadata["measured_bytes"] = sum(
            path.stat().st_size
            for path in maps_root.parent.rglob("*")
            if path.is_file() and path != metadata_path
        )
        temporary = metadata_path.with_name(f".{metadata_path.name}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(metadata, sort_keys=True, separators=(",", ":")), encoding="utf-8")
        with temporary.open("rb") as file:
            os.fsync(file.fileno())
        os.replace(temporary, metadata_path)
        _fsync_directory(maps_root.parent)
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError("could not record complete Vina map-cache metadata") from exc


def _valid_maps(directory: Path, provenance: dict[str, Any]) -> bool:
    try:
        metadata = json.loads((directory / "META.json").read_text(encoding="utf-8"))
        if any(metadata.get(key) != value for key, value in provenance.items()):
            return False
        files = metadata["files"]
        if not isinstance(files, dict) or not files:
            return False
        for name, details in files.items():
            if (
                not isinstance(name, str)
                or not name
                or Path(name).name != name
                or name in {".", ".."}
                or not isinstance(details, dict)
                or not isinstance(details.get("bytes"), int)
                or not isinstance(details.get("sha256"), str)
            ):
                return False
            path = directory / name
            if path.is_symlink() or not path.is_file():
                return False
            if path.stat().st_size != details["bytes"] or _sha256(path) != details["sha256"]:
                return False
        return True
    except (OSError, KeyError, TypeError, ValueError, AttributeError, json.JSONDecodeError):
        return False


def _map_files(directory: Path) -> list[Path]:
    return [path for path in directory.iterdir() if path.is_file() and path.name != "META.json"]


def _torsdof(pdbqt: str) -> int:
    for line in pdbqt.splitlines():
        if line.startswith("TORSDOF "):
            return int(line.split()[1])
    raise RuntimeError("ligand PDBQT contains no TORSDOF")


def _vina_version() -> str:
    import vina
    return str(getattr(vina, "__version__", "1.2.7"))


def _sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _fsync_tree(directory: Path) -> None:
    for path in directory.iterdir():
        if path.is_file():
            with path.open("rb") as file:
                os.fsync(file.fileno())
    _fsync_directory(directory)


def _fsync_directory(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # No SMILES, input content, or stderr is relayed to the caller.
        sys.stderr.write(f"{type(exc).__name__}: {str(exc)[:240]}\n")
        raise SystemExit(1)
