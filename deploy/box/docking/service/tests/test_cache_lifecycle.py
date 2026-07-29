from __future__ import annotations

import json
import multiprocessing
from pathlib import Path
from threading import Event, Thread
import time

import pytest

from docking_service.cache import ReceptorCache
from docking_service.metrics import DockingMetrics
from docking_service.models import Box, NormalizedRequest, PreparedReceptor
from docking_service.service import DockingService
from docking_service.settings import EngineConfig, Settings


def _prepare(destination: Path, marker: str = "prepared") -> PreparedReceptor:
    (destination / "source.pdb").write_text(f"SOURCE {marker}\n", encoding="ascii")
    receptor = destination / "receptor.pdb"
    receptor.write_text(f"RECEPTOR {marker}\n", encoding="ascii")
    pdbqt = destination / "receptor.pdbqt"
    pdbqt.write_text(f"PDBQT {marker}\n", encoding="ascii")
    box = Box(center=(1.0, 2.0, 3.0), size=(20.0, 20.0, 20.0), ligand_resname="HED")
    (destination / "box.json").write_text(
        json.dumps({"center": box.center, "size": box.size, "ligand_resname": box.ligand_resname}),
        encoding="utf-8",
    )
    return PreparedReceptor(pdb=receptor.read_text(), receptor_pdbqt=pdbqt, box=box, metadata={"prep_version": marker})


def _multiprocess_prepare(cache_root: str, ready: multiprocessing.synchronize.Event) -> None:
    cache = ReceptorCache(Path(cache_root), "concurrent-version")

    def prepare(destination: Path) -> PreparedReceptor:
        calls = Path(cache_root) / "prepare-calls.txt"
        with calls.open("a", encoding="utf-8") as file:
            file.write("1\n")
        # Hold the per-PDB lock long enough that the peer observes the published cache entry.
        time.sleep(0.2)
        return _prepare(destination, "concurrent")

    ready.wait(timeout=10)
    cache.get_or_prepare("1cx7", prepare)


def test_cache_hit_version_replacement_and_purge(tmp_path: Path) -> None:
    calls: list[str] = []
    cache = ReceptorCache(tmp_path, "version-one")

    def first(destination: Path) -> PreparedReceptor:
        calls.append("first")
        return _prepare(destination, "one")

    first_result = cache.get_or_prepare("1cx7", first)
    second_result = cache.get_or_prepare("1cx7", lambda destination: _prepare(destination, "unexpected"))
    assert calls == ["first"]
    assert second_result.pdb == first_result.pdb
    metadata = json.loads((tmp_path / "receptors" / "1cx7" / "META.json").read_text())
    assert metadata["preparation_hash"] == "version-one"
    assert metadata["measured_bytes"] > 0
    assert set(metadata["artifacts"]) == {"source.pdb", "receptor.pdb", "receptor.pdbqt", "box.json"}

    replacement_calls: list[str] = []
    newer = ReceptorCache(tmp_path, "version-two")
    newer.get_or_prepare("1cx7", lambda destination: replacement_calls.append("new") or _prepare(destination, "two"))
    assert replacement_calls == ["new"]
    assert newer.get_or_prepare("1cx7", lambda destination: _prepare(destination, "unexpected")).pdb == "RECEPTOR two\n"
    assert newer.purge("1cx7") is True
    assert newer.purge("1cx7") is False


def test_preparer_metadata_cannot_override_cache_integrity_fields(tmp_path: Path) -> None:
    cache = ReceptorCache(tmp_path, "trusted-hash")

    def prepare(destination: Path) -> PreparedReceptor:
        prepared = _prepare(destination)
        return PreparedReceptor(
            pdb=prepared.pdb,
            receptor_pdbqt=prepared.receptor_pdbqt,
            box=prepared.box,
            metadata={
                "preparation_hash": "untrusted",
                "artifacts": {},
                "measured_bytes": -1,
                "prep_version": "test",
            },
        )

    cache.get_or_prepare("1cx7", prepare)
    metadata = json.loads((tmp_path / "receptors" / "1cx7" / "META.json").read_text())
    assert metadata["preparation_hash"] == "trusted-hash"
    assert set(metadata["artifacts"]) == {"source.pdb", "receptor.pdb", "receptor.pdbqt", "box.json"}
    assert metadata["measured_bytes"] > 0


def test_shared_lease_keeps_artifact_paths_stable_until_docking_releases_them(
    tmp_path: Path,
) -> None:
    cache = ReceptorCache(tmp_path, "version")
    lease_entered = Event()
    release_lease = Event()
    purge_started = Event()
    purge_finished = Event()

    def hold_lease() -> None:
        with cache.lease("1cx7", lambda destination: _prepare(destination)) as prepared:
            assert prepared.receptor_pdbqt.is_file()
            lease_entered.set()
            assert release_lease.wait(timeout=5)
            assert prepared.receptor_pdbqt.is_file()

    def purge() -> None:
        assert lease_entered.wait(timeout=5)
        purge_started.set()
        assert cache.purge("1cx7") is True
        purge_finished.set()

    holder = Thread(target=hold_lease)
    purger = Thread(target=purge)
    holder.start()
    purger.start()
    assert purge_started.wait(timeout=5)
    time.sleep(0.1)
    assert not purge_finished.is_set()
    release_lease.set()
    holder.join(timeout=5)
    purger.join(timeout=5)
    assert not holder.is_alive()
    assert not purger.is_alive()
    assert purge_finished.is_set()


def test_purge_stale_removes_incomplete_and_digest_tampered_entries(tmp_path: Path) -> None:
    cache = ReceptorCache(tmp_path, "version")
    cache.get_or_prepare("1cx7", lambda destination: _prepare(destination))
    (tmp_path / "receptors" / "1cx7" / "receptor.pdb").write_text("tampered\n")
    incomplete = tmp_path / "receptors" / "2xyz"
    incomplete.mkdir()
    assert cache.purge_stale() == ["1cx7", "2xyz"]


def test_warm_uses_cache_without_docking(tmp_path: Path) -> None:
    settings = Settings(cache_dir=tmp_path, engine_name="test", engine=EngineConfig())
    prepared: list[str] = []

    class WarmPreparer:
        def prepare(self, request: NormalizedRequest, destination: Path) -> PreparedReceptor:
            prepared.append(request.pdbid)
            return _prepare(destination, request.pdbid)

    class NeverDock:
        def dock(self, *_args: object) -> list[object]:
            raise AssertionError("warm must not invoke a docking engine")

    service = DockingService(
        settings=settings,
        engine=NeverDock(),  # type: ignore[arg-type]
        metrics=DockingMetrics(),
        cache=ReceptorCache(tmp_path, settings.preparation_hash),
        receptor_preparer=WarmPreparer(),
        ligand_preparer=object(),  # type: ignore[arg-type]
    )
    service.warm(["1CX7"])
    service.warm(["1cx7"])
    assert prepared == ["1cx7"]


@pytest.mark.parametrize("bad_id", ["1CX7", "1Cx7", "../1cx7", "1cx7/", "/1cx7", "1cx", "1cx7a", "", "ab"])
def test_cache_rejects_invalid_pdbid_keys(tmp_path: Path, bad_id: str) -> None:
    cache = ReceptorCache(tmp_path, "version")
    with pytest.raises(ValueError, match="lowercase four-character"):
        cache.get_or_prepare(bad_id, lambda d: _prepare(d))


def test_cache_lease_rejects_invalid_pdbid_keys(tmp_path: Path) -> None:
    cache = ReceptorCache(tmp_path, "version")
    with pytest.raises(ValueError, match="lowercase four-character"):
        with cache.lease("1CX7", lambda d: _prepare(d)):
            pass


def test_cache_purge_rejects_invalid_pdbid_keys(tmp_path: Path) -> None:
    cache = ReceptorCache(tmp_path, "version")
    with pytest.raises(ValueError, match="lowercase four-character"):
        cache.purge("../1cx7")


def test_multiprocess_lock_publishes_one_complete_entry(tmp_path: Path) -> None:
    context = multiprocessing.get_context("spawn")
    ready = context.Event()
    workers = [context.Process(target=_multiprocess_prepare, args=(str(tmp_path), ready)) for _ in range(2)]
    for worker in workers:
        worker.start()
    ready.set()
    for worker in workers:
        worker.join(timeout=20)
        assert worker.exitcode == 0

    assert (tmp_path / "prepare-calls.txt").read_text(encoding="utf-8").splitlines() == ["1"]
    cache = ReceptorCache(tmp_path, "concurrent-version")
    assert cache.get_or_prepare("1cx7", lambda destination: _prepare(destination, "unexpected")).pdb == "RECEPTOR concurrent\n"
