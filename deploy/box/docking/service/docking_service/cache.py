from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
from tempfile import mkdtemp
from typing import Callable, Iterator

from .models import Box, PreparedReceptor


class ReceptorCache:
    """Versioned direct receptor cache with flock-protected atomic entry publication."""

    def __init__(self, cache_dir: Path, preparation_hash: str) -> None:
        self._cache_dir = cache_dir
        self._root = cache_dir / "receptors"
        self._locks = cache_dir / "locks"
        self._preparation_hash = preparation_hash

    @property
    def root(self) -> Path:
        return self._root

    @contextmanager
    def lock(self, name: str, *, shared: bool = False) -> Iterator[None]:
        self._locks.mkdir(parents=True, exist_ok=True)
        with (self._locks / f"{name}.lock").open("a+") as lock_file:
            mode = fcntl.LOCK_SH if shared else fcntl.LOCK_EX
            fcntl.flock(lock_file.fileno(), mode)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def get_or_prepare(self, pdbid: str, prepare: Callable[[Path], PreparedReceptor]) -> PreparedReceptor:
        self._validate_pdbid(pdbid)
        target = self._root / pdbid
        cached = self._load(target)
        if cached is not None:
            return cached
        with self.lock(pdbid):
            cached = self._load(target)
            if cached is not None:
                return cached
            self._root.mkdir(parents=True, exist_ok=True)
            temporary = Path(mkdtemp(prefix=f".{pdbid}.", dir=self._root))
            try:
                prepared = prepare(temporary)
                self._write_metadata(temporary, prepared)
                self._fsync_tree(temporary)
                self._publish_directory(temporary, target)
                cached = self._load(target)
                if cached is None:
                    raise RuntimeError("receptor cache publish did not create a complete entry")
                return cached
            except Exception:
                shutil.rmtree(temporary, ignore_errors=True)
                raise

    @contextmanager
    def lease(
        self,
        pdbid: str,
        prepare: Callable[[Path], PreparedReceptor],
    ) -> Iterator[PreparedReceptor]:
        """Hold a shared per-receptor lock while returned paths are in use."""
        self._validate_pdbid(pdbid)
        target = self._root / pdbid
        for _attempt in range(3):
            self.get_or_prepare(pdbid, prepare)
            with self.lock(pdbid, shared=True):
                cached = self._load(target)
                if cached is not None:
                    yield cached
                    return
        raise RuntimeError("receptor cache entry changed repeatedly before it could be leased")

    def _publish_directory(self, temporary: Path, target: Path) -> None:
        """Publish a complete sibling directory without exposing partial contents.

        POSIX cannot replace a non-empty directory with one rename.  Under the per-PDB
        flock, move an obsolete entry aside, publish the fsynced replacement, then remove
        the retired sibling.  If publication fails, restore the old complete entry.
        """
        retired = self._root / f".{target.name}.retired.{os.getpid()}"
        moved_old = False
        published = False
        try:
            if target.exists():
                if retired.exists():
                    shutil.rmtree(retired)
                os.rename(target, retired)
                moved_old = True
                self._fsync_directory(self._root)
            os.rename(temporary, target)
            published = True
            self._fsync_directory(self._root)
        except Exception:
            # If the new name was installed but its parent fsync failed, move it back to
            # the caller-owned temporary path before restoring the last known complete entry.
            if published and target.exists() and not temporary.exists():
                try:
                    os.rename(target, temporary)
                    published = False
                except OSError:
                    pass
            if moved_old and retired.exists() and not target.exists():
                os.rename(retired, target)
                self._fsync_directory(self._root)
            raise
        if moved_old and retired.exists():
            shutil.rmtree(retired, ignore_errors=True)
        # A process killed between the two publication renames can leave a hidden retired
        # sibling. A now-complete target supersedes it, so clean it only after publication.
        for stale in self._root.glob(f".{target.name}.retired.*"):
            if stale.exists():
                shutil.rmtree(stale, ignore_errors=True)
        self._fsync_directory(self._root)

    def purge(self, pdbid: str) -> bool:
        self._validate_pdbid(pdbid)
        with self.lock(pdbid):
            entry = self._root / pdbid
            if not entry.exists():
                return False
            shutil.rmtree(entry)
            self._fsync_directory(self._root)
            return True

    def purge_stale(self) -> list[str]:
        if not self._root.exists():
            return []
        removed: list[str] = []
        for entry in sorted(self._root.iterdir()):
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            with self.lock(entry.name):
                if self._load(entry) is None and entry.exists():
                    shutil.rmtree(entry)
                    removed.append(entry.name)
        if removed:
            self._fsync_directory(self._root)
        return removed

    def _load(self, entry: Path) -> PreparedReceptor | None:
        receptor = entry / "receptor.pdb"
        receptor_pdbqt = entry / "receptor.pdbqt"
        source = entry / "source.pdb"
        box_file = entry / "box.json"
        metadata = entry / "META.json"
        if not all(path.is_file() for path in (source, receptor, receptor_pdbqt, box_file, metadata)):
            return None
        try:
            details = json.loads(metadata.read_text(encoding="utf-8"))
            if details.get("preparation_hash") != self._preparation_hash:
                return None
            if not self._validate_digests(entry, details):
                return None
            box_data = json.loads(box_file.read_text(encoding="utf-8"))
            center = tuple(float(value) for value in box_data["center"])
            size = tuple(float(value) for value in box_data["size"])
            if len(center) != 3 or len(size) != 3 or any(value <= 0 for value in size):
                return None
            pdb = receptor.read_text(encoding="utf-8")
        except (KeyError, TypeError, ValueError, json.JSONDecodeError, OSError):
            return None
        return PreparedReceptor(
            pdb=pdb,
            receptor_pdbqt=receptor_pdbqt,
            box=Box(
                center=center,  # type: ignore[arg-type]
                size=size,  # type: ignore[arg-type]
                ligand_resname=box_data.get("ligand_resname"),
                fallback_reason=box_data.get("apo_fallback_reason"),
            ),
            metadata=details,
        )

    def _write_metadata(self, entry: Path, prepared: PreparedReceptor) -> None:
        required = (entry / "source.pdb", entry / "receptor.pdb", prepared.receptor_pdbqt, entry / "box.json")
        if not all(path.is_file() for path in required):
            raise RuntimeError("receptor preparation did not produce all cache artifacts")
        maps = entry / "maps"
        maps.mkdir(exist_ok=True)
        artifacts = self._artifact_details(entry)
        metadata = {
            **prepared.metadata,
            # Cache-owned integrity fields must not be overridable by a preparer.
            "cache_format": 2,
            "preparation_hash": self._preparation_hash,
            "source_sha256": artifacts["source.pdb"]["sha256"],
            "receptor_sha256": artifacts["receptor.pdb"]["sha256"],
            "receptor_pdbqt_sha256": artifacts["receptor.pdbqt"]["sha256"],
            "box_sha256": artifacts["box.json"]["sha256"],
            "artifacts": artifacts,
            # Deliberately excludes META.json itself, avoiding recursive size accounting.
            "measured_bytes": self._measured_payload_bytes(entry),
            "maps": {"state": "not-built", "subcaches": {}},
        }
        (entry / "META.json").write_text(
            json.dumps(metadata, sort_keys=True, separators=(",", ":")), encoding="utf-8"
        )

    @staticmethod
    def _validate_digests(entry: Path, details: dict[str, object]) -> bool:
        artifacts = details.get("artifacts")
        if not isinstance(artifacts, dict):
            return False
        for name in ("source.pdb", "receptor.pdb", "receptor.pdbqt", "box.json"):
            recorded = artifacts.get(name)
            if not isinstance(recorded, dict) or not isinstance(recorded.get("sha256"), str):
                return False
            path = entry / name
            if ReceptorCache._sha256_file(path) != recorded["sha256"]:
                return False
            if path.stat().st_size != recorded.get("bytes"):
                return False
        return True

    @staticmethod
    def _artifact_details(entry: Path) -> dict[str, dict[str, int | str]]:
        names = ("source.pdb", "receptor.pdb", "receptor.pdbqt", "box.json")
        return {
            name: {"sha256": ReceptorCache._sha256_file(entry / name), "bytes": (entry / name).stat().st_size}
            for name in names
        }

    @staticmethod
    def _measured_payload_bytes(entry: Path) -> int:
        """Measure all entry payload files, excluding self-describing META.json."""
        return sum(
            path.stat().st_size
            for path in entry.rglob("*")
            if path.is_file() and path.name != "META.json"
        )

    @staticmethod
    def _sha256_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as artifact:
            for block in iter(lambda: artifact.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest()

    @staticmethod
    def _validate_pdbid(pdbid: str) -> None:
        if len(pdbid) != 4 or not pdbid.isalnum() or pdbid.lower() != pdbid:
            raise ValueError("cache PDB ID must be a lowercase four-character identifier")

    @staticmethod
    def _fsync_tree(directory: Path) -> None:
        for path in directory.rglob("*"):
            if path.is_file():
                with path.open("rb") as artifact:
                    os.fsync(artifact.fileno())
        for path in sorted((path for path in directory.rglob("*") if path.is_dir()), reverse=True):
            ReceptorCache._fsync_directory(path)
        ReceptorCache._fsync_directory(directory)

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        if not directory.exists():
            return
        directory_fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
