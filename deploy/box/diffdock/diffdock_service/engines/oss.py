from __future__ import annotations

import logging
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from ..errors import DockFailure, EngineUnavailable
from ..models import EngineRequest, Pose
from ..settings import Settings

logger = logging.getLogger(__name__)

# DiffDock writes one file per pose into {out_dir}/{complex_name}/:
#
#   rank1.sdf                      the top pose, written a second time without a confidence
#   rank{N}_confidence{X:.2f}.sdf  every pose, confidence baked into the FILENAME
#   rank{N}_reverseprocess.pdb     only with --save_visualisation
#
# ⚠ The confidence is formatted `%.2f` on its way into that filename, so this engine can only
# ever report two decimal places. Asinex returned full float64 (-1.2901878356933594). Nothing
# downstream does arithmetic on it — the dashboard prints it — but it IS a visible difference
# from the captured contract and it is recorded in the README rather than hidden here.
_POSE_RE = re.compile(r"^rank(?P<rank>\d+)_confidence(?P<confidence>-?\d+(?:\.\d+)?)\.sdf$")


class OssDiffDockEngine:
    """Runs upstream gcorso/DiffDock (MIT) as a subprocess.

    NOT the NVIDIA NIM container: NVIDIA AI Enterprise was refused for this project and NIM
    does not support GeForce cards, which is what the box has. See docs/BOX-SPEC.md.

    Inference itself is unverified — it cannot be run until the box exists. Everything up to
    and including the argv this builds, and everything after the output directory is written,
    is covered by tests using a stub interpreter.
    """

    name = "oss"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def preflight(self) -> None:
        repo = self._settings.repo_dir
        if not (repo / "inference.py").is_file():
            raise EngineUnavailable(f"DiffDock checkout missing at {repo}/inference.py")
        model_dir = self._settings.model_dir
        if not model_dir.is_dir():
            raise EngineUnavailable(f"DiffDock weights missing at {model_dir}")
        if not any(model_dir.iterdir()):
            raise EngineUnavailable(f"DiffDock weights directory {model_dir} is empty")

    def dock(self, request: EngineRequest) -> list[Pose]:
        self.preflight()
        work_root = self._settings.work_dir
        work_root.mkdir(parents=True, exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix="dock-", dir=work_root))
        try:
            return self._run(request, work)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    # ── internals ────────────────────────────────────────────────────────────

    def _run(self, request: EngineRequest, work: Path) -> list[Pose]:
        protein_path = work / "protein.pdb"
        ligand_path = work / "ligand.sdf"
        out_dir = work / "out"
        protein_path.write_text(request.protein_pdb, encoding="utf-8")
        ligand_path.write_text(request.ligand_sdf, encoding="utf-8")

        argv = self.build_argv(request, protein_path, ligand_path, out_dir)
        logger.info("diffdock inference starting: poses=%d", request.num_poses)
        try:
            completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
                argv,
                cwd=str(self._settings.repo_dir),
                capture_output=True,
                text=True,
                timeout=self._settings.engine.inference_timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise DockFailure(
                f"DiffDock exceeded {self._settings.engine.inference_timeout_seconds}s"
            ) from exc

        if completed.returncode != 0:
            # DiffDock's own failure text is the most useful thing available; keep the last
            # line only, so an upstream stack trace does not become the user-facing message.
            tail = (completed.stderr or completed.stdout or "").strip().splitlines()
            detail = tail[-1] if tail else f"exit {completed.returncode}"
            logger.error("diffdock inference failed: %s", detail)
            raise DockFailure(f"DiffDock inference failed: {detail}")

        poses = self.collect_poses(out_dir, save_trajectory=request.save_trajectory)
        if not poses:
            raise DockFailure("Fail to generate complex graph -no poses were written")
        return poses

    def build_argv(
        self,
        request: EngineRequest,
        protein_path: Path,
        ligand_path: Path,
        out_dir: Path,
    ) -> list[str]:
        settings = self._settings
        argv = [
            settings.python_executable,
            "-m",
            "inference",
            "--config",
            str(settings.repo_dir / "default_inference_args.yaml"),
            "--complex_name",
            "",  # the captured poses are titled `_rank1`, i.e. an EMPTY complex name
            "--protein_path",
            str(protein_path),
            "--ligand_description",
            str(ligand_path),
            "--out_dir",
            str(out_dir),
            "--samples_per_complex",
            str(request.num_poses),
            "--inference_steps",
            str(request.time_divisions),
            "--actual_steps",
            str(request.steps),
            "--batch_size",
            str(settings.engine.batch_size),
            "--model_dir",
            str(settings.model_dir / "score_model"),
            "--confidence_model_dir",
            str(settings.model_dir / "confidence_model"),
        ]
        if request.save_trajectory:
            argv.append("--save_visualisation")
        return argv

    @staticmethod
    def collect_poses(out_dir: Path, *, save_trajectory: bool) -> list[Pose]:
        """Read {out_dir}/*/rank{N}_confidence{X}.sdf, ranked best-first.

        `rank1.sdf` is deliberately skipped: DiffDock writes the top pose twice and counting
        it would return one pose more than was asked for.
        """
        if not out_dir.is_dir():
            return []

        found: list[tuple[int, float, Path]] = []
        for candidate in sorted(out_dir.rglob("rank*_confidence*.sdf")):
            match = _POSE_RE.match(candidate.name)
            if match is None:
                continue
            found.append((int(match["rank"]), float(match["confidence"]), candidate))

        poses: list[Pose] = []
        for rank, confidence, path in sorted(found, key=lambda item: item[0]):
            trajectory = ""
            if save_trajectory:
                visualisation = path.with_name(f"rank{rank}_reverseprocess.pdb")
                if visualisation.is_file():
                    trajectory = visualisation.read_text(encoding="utf-8")
            poses.append(
                Pose(
                    sdf=path.read_text(encoding="utf-8"),
                    confidence=confidence,
                    trajectory=trajectory,
                )
            )
        return poses
