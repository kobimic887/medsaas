"""Populate ESM2 cache in a one-shot runtime container, before accepting jobs."""
from pathlib import Path
import hashlib
import urllib.request

import esm
import torch

# Pinned after retrieving these exact artifacts from Meta's official HTTPS endpoints.
# Verify before torch deserialization, including already populated caches.
expected = {
    "esm2_t33_650M_UR50D.pt": "ea9d0522b335a8778dea6535a65301f10208dece28cd5865482b0b1fc446168c",
    "esm2_t33_650M_UR50D-contact-regression.pt": "8ffe6edbd4173dc8d45c2cd5cb27d43aad77ec26b4c768200c58ae1f96693575",
}
for name, digest in expected.items():
    path = Path(torch.hub.get_dir()) / "checkpoints" / name
    if not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        category = "regression" if "contact-regression" in name else "models"
        temporary = path.with_suffix(".download")
        try:
            urllib.request.urlretrieve(f"https://dl.fbaipublicfiles.com/fair-esm/{category}/{name}", temporary)
            with temporary.open("rb") as stream:
                h = hashlib.sha256()
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    h.update(block)
            if h.hexdigest() != digest:
                raise SystemExit(f"Downloaded ESM SHA256 mismatch: {name}")
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest() if hasattr(hashlib, "file_digest") else None
        if actual is None:
            stream.seek(0)
            h = hashlib.sha256()
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                h.update(block)
            actual = h.hexdigest()
    if actual != digest:
        raise SystemExit(f"ESM SHA256 mismatch: {path}")

# PDB input still requires ESM2 embeddings in upstream InferenceDataset.
# This runs on CPU and exits, releasing memory before serving inference.
model, _ = esm.pretrained.esm2_t33_650M_UR50D()
for filename in ("esm2_t33_650M_UR50D.pt", "esm2_t33_650M_UR50D-contact-regression.pt"):
    artifact = Path(torch.hub.get_dir()) / "checkpoints" / filename
    if not artifact.is_file() or not artifact.stat().st_size:
        raise SystemExit(f"Embedding cache incomplete: {artifact}")
print("ESM2 embedding cache prepared")
