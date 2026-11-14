"""Check the actual inference process's CUDA context before loading the models."""
from __future__ import annotations

import runpy
import faulthandler
import signal


def require_cuda() -> None:
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("DiffDock requires CUDA; GPU access is unavailable")
    # Availability alone did not catch every lost WSL/container context. Prove
    # a device operation in this process, without a second health-probe process
    # reserving VRAM alongside an active inference.
    torch.empty(1, device="cuda").zero_()
    torch.cuda.synchronize()


def main() -> None:
    # Operators can inspect a stuck, measured request PID without installing a
    # profiler, logging input tensors, or terminating unrelated GPU work.
    diagnostic_signal = getattr(signal, "SIGUSR1", None)
    if diagnostic_signal is not None:
        faulthandler.register(diagnostic_signal, all_threads=True)
    try:
        require_cuda()
        runpy.run_module("inference", run_name="__main__")
    finally:
        if diagnostic_signal is not None:
            faulthandler.unregister(diagnostic_signal)


if __name__ == "__main__":
    main()
