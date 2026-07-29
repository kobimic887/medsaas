from __future__ import annotations

from dataclasses import replace
import hashlib
import logging
from pathlib import Path
from tempfile import TemporaryDirectory

from .cache import ReceptorCache
from .engines.autodock_gpu import AutoDockGpuEngine
from .engines.base import DockingEngine
from .engines.replay import ReplayEngine
from .errors import DockingFailure
from .ligand import LigandPreparer, MeekoLigandPreparer, ReplayLigandPreparer, validate_decoded_smiles
from .metrics import DockingMetrics
from .models import DockingResult, NormalizedRequest
from .receptor import HttpRcsbClient, RcsbReceptorPreparer, ReceptorPreparer, ReplayReceptorPreparer
from .serializer import serialize_sdf
from .settings import Settings

logger = logging.getLogger(__name__)


class DockingService:
    def __init__(
        self,
        *,
        settings: Settings,
        engine: DockingEngine,
        metrics: DockingMetrics,
        cache: ReceptorCache,
        receptor_preparer: ReceptorPreparer,
        ligand_preparer: LigandPreparer,
    ) -> None:
        self._settings = settings
        self._engine = engine
        self._metrics = metrics
        self._cache = cache
        self._receptor_preparer = receptor_preparer
        self._ligand_preparer = ligand_preparer

    @classmethod
    def for_engine(cls, settings: Settings, engine: DockingEngine, metrics: DockingMetrics) -> "DockingService":
        if isinstance(engine, ReplayEngine):
            receptor_preparer: ReceptorPreparer = ReplayReceptorPreparer(settings.receptor)
            ligand_preparer: LigandPreparer = ReplayLigandPreparer()
        else:
            receptor_preparer = RcsbReceptorPreparer(
                HttpRcsbClient(
                    timeout_seconds=settings.receptor.rcsb_timeout_seconds,
                    max_source_bytes=settings.receptor.max_source_bytes,
                ),
                settings.receptor,
            )
            ligand_preparer = MeekoLigandPreparer()
        return cls(
            settings=settings,
            engine=engine,
            metrics=metrics,
            cache=ReceptorCache(settings.cache_dir, settings.preparation_hash),
            receptor_preparer=receptor_preparer,
            ligand_preparer=ligand_preparer,
        )

    def dock(self, request: NormalizedRequest) -> DockingResult:
        validate_decoded_smiles(request.smiles)
        # Do not download or mutate a receptor cache for an explicitly unqualified backend.
        if isinstance(self._engine, AutoDockGpuEngine):
            self._engine.require_qualified()
        if isinstance(self._engine, ReplayEngine):
            self._engine.assert_supported(request)
        with self._cache.lease(
            request.pdbid,
            lambda destination: self._receptor_preparer.prepare(request, destination),
        ) as prepared_receptor:
            with TemporaryDirectory(prefix="docking-ligand-") as temporary:
                prepared_ligand = self._ligand_preparer.prepare(request, Path(temporary))
                poses = self._engine.dock(
                    prepared_receptor.receptor_pdbqt,
                    prepared_ligand.ligand_pdbqt,
                    prepared_receptor.box,
                    self._settings.engine,
                )
                poses = [
                    replace(pose, torsdof=prepared_ligand.torsdof)
                    if pose.torsdof is None
                    else pose
                    for pose in poses
                ]
            if not poses:
                raise DockingFailure("docking engine returned zero poses")
            self._metrics.increment("successful_docks")
            self._metrics.increment(f"pose_count_{len(poses)}")
            if len(poses) != self._settings.engine.expected_pose_count:
                self._metrics.increment("pose_count_mismatch")
                logger.warning(
                    "docking pose count differs from configured target",
                    extra={
                        "pdbid": request.pdbid,
                        "pose_count": len(poses),
                        "expected_pose_count": self._settings.engine.expected_pose_count,
                        "smiles_sha256": request.smiles_sha256,
                    },
                )
            return DockingResult(
                pdb=prepared_receptor.pdb,
                sdf=serialize_sdf(poses, request.smiles, self._settings.engine),
            )

    def warm(self, pdbids: list[str]) -> None:
        for pdbid in pdbids:
            normalized = pdbid.strip().lower()
            if len(normalized) != 4 or not normalized.isalnum():
                raise ValueError(f"invalid PDB ID for warm: {pdbid!r}")
            request = NormalizedRequest(
                pdbid=normalized,
                smiles="warm-cache-only",
                smiles_sha256=hashlib.sha256(b"warm-cache-only").hexdigest(),
            )
            self._cache.get_or_prepare(
                normalized,
                lambda destination, current=request: self._receptor_preparer.prepare(current, destination),
            )

    def purge(self, pdbid: str) -> bool:
        return self._cache.purge(pdbid)

    def purge_stale(self) -> list[str]:
        return self._cache.purge_stale()
