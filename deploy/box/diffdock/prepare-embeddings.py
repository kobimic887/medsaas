"""Populate ESM2 cache in a one-shot runtime container, before accepting jobs."""
from pathlib import Path

import esm
import torch

# PDB input still requires ESM2 embeddings in upstream InferenceDataset.
# This runs on CPU and exits, releasing memory before serving inference.
model, _ = esm.pretrained.esm2_t33_650M_UR50D()
for filename in ("esm2_t33_650M_UR50D.pt", "esm2_t33_650M_UR50D-contact-regression.pt"):
    artifact = Path(torch.hub.get_dir()) / "checkpoints" / filename
    if not artifact.is_file() or not artifact.stat().st_size:
        raise SystemExit(f"Embedding cache incomplete: {artifact}")
print("ESM2 embedding cache prepared")
